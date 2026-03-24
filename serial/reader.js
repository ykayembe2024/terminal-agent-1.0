/**
 * ==============================================================
 * reader.js - Lecteur de port série pour balances SICS
 * app/serial/reader.js
 *
 * RESPONSABILITÉ UNIQUE :
 *   - Lire les données envoyées par la balance via le port série
 *   - Nettoyer et parser les trames SICS
 *   - Extraire les poids STABLES uniquement (S S)
 *   - Transmettre CHAQUE poids détecté au niveau supérieur
 *
 * ⚠️ IMPORTANT :
 *   - AUCUNE logique métier ici
 *   - AUCUNE déduplication métier ici
 *   - Le reader ne "décide" JAMAIS si un poids doit être envoyé
 *
 * La logique de décision appartient exclusivement à la StateMachine
 * ==============================================================
 */

const {createRequire} = require("module");
const requireFile = createRequire(__filename);
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const config = requireFile('../config');
const logger = requireFile('../core/logger');

/**
 * Démarre le lecteur de port série avec reconnexion automatique
 * @function startReader
 * @param {string} portPath - Chemin du port série (ex: 'COM11')
 * @param {Function} onTerminal - Callback appelé quand le terminal est identifié
 * @param {Function} onWeight - Callback appelé pour chaque poids détecté
 * @param {Function} onConnectionStatus - Callback appelé quand l'état de connexion change
 * @returns {Object} Interface de contrôle { stop() }
 */
function startReader(portPath, onTerminal, onWeight, onConnectionStatus) {

  /**
   * Variables d'état pour la gestion de connexion
   * @type {SerialPort|null}
   */
  let port = null;

  /**
   * Parser pour les trames ligne par ligne
   * @type {ReadlineParser|null}
   */
  let parser = null;

  /**
   * Timer pour le polling périodique des poids
   * @type {NodeJS.Timeout|null}
   */
  let pollingInterval = null;

  /**
   * Timer pour les tentatives de reconnexion
   * @type {NodeJS.Timeout|null}
   */
  let reconnectTimeout = null;

  /**
   * Nombre de tentatives de reconnexion effectuées
   * @type {number}
   */
  let reconnectAttempts = 0;

  /**
   * Nombre maximum de tentatives de reconnexion
   * @constant {number}
   */
  const maxReconnectAttempts = 10;

  /**
   * Délai de base pour le retry exponentiel (ms)
   * @constant {number}
   */
  const baseReconnectDelay = 1000; // 1 seconde

  /**
   * Délai maximum entre les tentatives de reconnexion (ms)
   * @constant {number}
   */
  const maxReconnectDelay = 30000; // 30 secondes

  /**
   * Flag interne pour éviter de traiter plusieurs fois
   * l'identification du terminal (commande I4).
   * @type {boolean}
   */
  let terminalIdentified = false;

  /**
   * Notifie le changement d'état de connexion série
   * @function notifyConnectionStatus
   * @param {boolean} connected - true si connecté, false si déconnecté
   * @returns {void}
   */
  function notifyConnectionStatus(connected) {
    if (onConnectionStatus) {
      onConnectionStatus(connected);
    }
  }

  /**
   * Nettoie toutes les ressources (timers, connexions)
   * @function cleanup
   * @returns {void}
   */
  function cleanup() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (port) {
      port.removeAllListeners();
      if (port.isOpen) {
        port.close();
      }
      port = null;
    }
    parser = null;
    terminalIdentified = false;
  }

  function startPolling() {
    if (pollingInterval) return;

    pollingInterval = setInterval(() => {
      if (port && port.isOpen) {
        port.write('SI\r\n');
      }
    }, config.SYSTEM.pollIntervalMs);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
      logger.error(`Échec de reconnexion après ${maxReconnectAttempts} tentatives`);
      notifyConnectionStatus(false);
      return;
    }

    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), maxReconnectDelay);
    reconnectAttempts++;

    logger.warn(`Tentative de reconnexion ${reconnectAttempts}/${maxReconnectAttempts} dans ${delay}ms`);

    reconnectTimeout = setTimeout(() => {
      connect();
    }, delay);
  }

  function connect() {
    cleanup();

    try {
      port = new SerialPort({
        path: portPath,
        baudRate: config.SERIAL.baudRate,
        dataBits: config.SERIAL.dataBits,
        stopBits: config.SERIAL.stopBits,
        parity: config.SERIAL.parity,
        autoOpen: true
      });

      parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      // Gestion des événements
      port.on('open', () => {
        logger.info(`Port série ouvert sur ${portPath}`);
        reconnectAttempts = 0; // Reset des tentatives
        notifyConnectionStatus(true);
        startPolling();

        // Demande identité du terminal
        port.write('I4\r\n');
      });

      port.on('error', (err) => {
        logger.error(`Erreur port série : ${err.message}`);
        notifyConnectionStatus(false);
        scheduleReconnect();
      });

      port.on('close', () => {
        logger.warn('Port série fermé');
        stopPolling();
        notifyConnectionStatus(false);
        scheduleReconnect();
      });

      // Gestion des données
      parser.on('data', (line) => {
        const cleaned = line
          .replace(/\x02/g, '')
          .replace(/\x03/g, '')
          .trim();

        if (!cleaned) return;

        logger.info(`Trame reçue : ${cleaned}`);

        // Identification terminal
        if (cleaned.startsWith('I4') && cleaned.includes('"')) {
          if (terminalIdentified) return;

          const match = cleaned.match(/"(.+?)"/);
          if (match) {
            const terminalCode = match[1];
            terminalIdentified = true;
            logger.info(`Terminal identifié : ${terminalCode}`);
            if (onTerminal) onTerminal(terminalCode);
          }
          return;
        }

        // Poids stable uniquement
        if (!cleaned.startsWith('S S')) return;

        const match = cleaned.match(/([+-]?\d+(\.\d+)?)/);
        if (!match) return;

        const weight = parseFloat(match[1]);
        if (isNaN(weight)) return;

        logger.info(`Poids stable détecté : ${weight} kg`);
        if (onWeight) onWeight(weight);
      });

    } catch (err) {
      logger.error(`Erreur lors de l'ouverture du port : ${err.message}`);
      notifyConnectionStatus(false);
      scheduleReconnect();
    }
  }

  // Démarrage initial de la connexion
  connect();

  /**
   * Fonction d'arrêt propre du lecteur série
   * Nettoie toutes les ressources et notifie la déconnexion
   * @function stop
   * @returns {void}
   */
  const stop = () => {
    cleanup();
    notifyConnectionStatus(false);
  };

  /**
   * Interface publique du lecteur série
   * @typedef {Object} SerialReader
   * @property {function(): void} stop - Arrête proprement le lecteur
   */

  /**
   * Retourne l'interface de contrôle du lecteur
   * @returns {SerialReader} Interface avec méthode stop()
   */
  return { stop };
}

/**
 * Module exports - Fonction principale pour démarrer le lecteur série
 * @type {function}
 */
module.exports = startReader;
