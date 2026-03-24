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
 * @param {string|null} portPath - Chemin du port série (ex: 'COM11') ou null en mode auto-détection
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
   * Délai fixe utilisé après la 10e tentative (ms)
   * Permet de continuer les retries sans arrêter l'agent.
   * @constant {number}
   */
  const retryAfterMaxDelay = 60000; // 1 minute

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
   * Indique si le mode "retry toutes les 1 minute" a déjà été annoncé
   * pour éviter les logs répétitifs.
   * @type {boolean}
   */
  let maxRetryModeAnnounced = false;

  /**
   * Compteur de retries effectués après l'entrée en mode 1 minute.
   * @type {number}
   */
  let postMaxRetryCount = 0;

  /**
   * État de persistance d'erreur série pour éviter la duplication des logs.
   * @type {{message: string, firstAt: number, lastAt: number, count: number}|null}
   */
  let serialErrorState = null;

  /**
   * Flag interne pour éviter de traiter plusieurs fois
   * l'identification du terminal (commande I4).
   * @type {boolean}
   */
  let terminalIdentified = false;

  /**
   * Mémorise le début de la séquence de reconnexion en cours.
   * @type {number|null}
   */
  let reconnectStartedAt = null;

  /**
   * Port réellement utilisé par la connexion active.
   * Peut changer en mode auto-détection.
   * @type {string|null}
   */
  let currentPortPath = null;

  /**
   * Notifie le changement d'état de connexion série
   * @function notifyConnectionStatus
   * @param {boolean} connected - true si connecté, false si déconnecté
   * @returns {void}
   */
  function notifyConnectionStatus(connected) {
    if (!onConnectionStatus) return;

    try {
      onConnectionStatus(connected);
    } catch (err) {
      logger.error(`Erreur callback état connexion série : ${err.message}`);
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
        port.write('SI\r\n', (err) => {
          if (!err) return;
          logger.error(`Erreur écriture SI sur port série : ${err.message}`);
          stopPolling();
          notifyConnectionStatus(false);
          scheduleReconnect();
        });
      }
    }, config.SYSTEM.pollIntervalMs);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  /**
   * Indique si l'auto-détection série est activée.
   * @returns {boolean}
   */
  function isAutoDetectEnabled() {
    return config.SERIAL.autoDetect === true;
  }

  /**
   * Retourne la liste des ports série candidats à tester.
   * En mode fixe: retourne uniquement le port configuré.
   * En mode auto: retourne tous les ports, en priorisant le port configuré si présent.
   * @returns {Promise<string[]>}
   */
  async function getCandidatePorts() {
    if (!isAutoDetectEnabled()) {
      return portPath ? [portPath] : [];
    }

    const ports = await SerialPort.list();
    const paths = ports.map((item) => item.path).filter(Boolean);

    if (!portPath) {
      return paths;
    }

    const dedup = [portPath, ...paths].filter((value, index, arr) => arr.indexOf(value) === index);
    return dedup;
  }

  /**
   * Teste un port en envoyant une commande SICS I4 pour confirmer qu'il s'agit d'une balance.
   * @param {string} candidatePath - Port à tester
   * @returns {Promise<{ ok: boolean, terminalCode: string|null }>} Résultat du test
   */
  async function probeSicsPort(candidatePath) {
    const timeoutMs = Number(config.SERIAL.detectProbeTimeoutMs) || 2500;

    return new Promise((resolve) => {
      let localPort = null;
      let localParser = null;
      let done = false;
      let probeTimer = null;
      let i4Interval = null;

      const finish = (ok, terminalCode = null) => {
        if (done) return;
        done = true;

        if (probeTimer) clearTimeout(probeTimer);
        if (i4Interval) clearInterval(i4Interval);

        try {
          if (localParser) localParser.removeAllListeners();
          if (localPort) {
            localPort.removeAllListeners();
            if (localPort.isOpen) {
              localPort.close(() => resolve({ ok, terminalCode }));
              return;
            }
          }
        } catch {
          // Erreur de fermeture ignorée volontairement pendant le probe
        }

        resolve({ ok, terminalCode });
      };

      try {
        localPort = new SerialPort({
          path: candidatePath,
          baudRate: config.SERIAL.baudRate,
          dataBits: config.SERIAL.dataBits,
          stopBits: config.SERIAL.stopBits,
          parity: config.SERIAL.parity,
          autoOpen: false
        });

        localPort.open((openErr) => {
          if (openErr) {
            finish(false, null);
            return;
          }

          localParser = localPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

          localParser.on('data', (line) => {
            const cleaned = String(line || '')
              .replace(/\x02/g, '')
              .replace(/\x03/g, '')
              .trim();

            if (!cleaned) return;
            if (!cleaned.startsWith('I4') || !cleaned.includes('"')) return;

            const match = cleaned.match(/"(.+?)"/);
            if (!match) return;

            finish(true, match[1]);
          });

          localPort.on('error', () => finish(false, null));
          localPort.on('close', () => finish(false, null));

          localPort.write('I4\r\n', (writeErr) => {
            if (writeErr) {
              finish(false, null);
            }
          });

          i4Interval = setInterval(() => {
            if (localPort && localPort.isOpen) {
              localPort.write('I4\r\n', (writeErr) => {
                if (writeErr) {
                  finish(false, null);
                }
              });
            }
          }, 600);

          probeTimer = setTimeout(() => finish(false, null), timeoutMs);
        });
      } catch {
        finish(false, null);
      }
    });
  }

  /**
   * Résout le port à utiliser pour la connexion active.
   * En mode auto-détection, parcourt tous les ports et sélectionne le premier
   * qui répond à la commande SICS I4.
   * @returns {Promise<string>} Port sélectionné
   */
  async function resolvePortPath() {
    if (!isAutoDetectEnabled()) {
      if (!portPath) {
        throw new Error('Aucun port série configuré');
      }
      return portPath;
    }

    const candidates = await getCandidatePorts();

    if (!candidates.length) {
      throw new Error('Aucun port série détecté sur la machine');
    }

    for (const candidate of candidates) {
      const result = await probeSicsPort(candidate);
      if (result.ok) {
        logger.info(`Auto-détection série: balance trouvée sur ${candidate}${result.terminalCode ? ` (terminal=${result.terminalCode})` : ''}`);
        return candidate;
      }
    }

    throw new Error('Aucun port balance SICS valide détecté');
  }

  /**
   * Log une erreur série persistante sans duplication inutile.
   * Écrit une ligne au début, puis une ligne de persistance périodique.
   * @param {Error} err - Erreur série capturée
   * @returns {void}
   */
  function logSerialError(err) {
    const now = Date.now();
    const message = `Erreur port série : ${err.message}`;

    if (!serialErrorState || serialErrorState.message !== message) {
      serialErrorState = {
        message,
        firstAt: now,
        lastAt: now,
        count: 1
      };
      logger.error(`${message} (début=${new Date(now).toISOString()})`);
      return;
    }

    serialErrorState.count += 1;
    serialErrorState.lastAt = now;

    // Une ligne de persistance toutes les 10 occurrences suffit.
    if (serialErrorState.count % 10 === 0) {
      logger.warn(
        `Problème série persistant: ${serialErrorState.count} occurrences (début=${new Date(serialErrorState.firstAt).toISOString()}, dernière=${new Date(serialErrorState.lastAt).toISOString()})`
      );
    }
  }

  /**
   * Réinitialise et clôture l'état d'erreur série si un problème existait.
   * @returns {void}
   */
  function clearSerialErrorState() {
    if (!serialErrorState) return;

    logger.info(
      `Connexion série rétablie après ${serialErrorState.count} occurrence(s) d'erreur (début=${new Date(serialErrorState.firstAt).toISOString()}, dernière=${new Date(serialErrorState.lastAt).toISOString()})`
    );

    serialErrorState = null;
  }

  function scheduleReconnect() {
    // Évite les timers de reconnexion multiples si 'error' et 'close'
    // sont émis quasi en même temps lors d'un débranchement brutal.
    if (reconnectTimeout) {
      return;
    }

    let delay = 0;

    if (!reconnectStartedAt) {
      reconnectStartedAt = Date.now();
      logger.warn(`Début des tentatives de reconnexion série (début=${new Date(reconnectStartedAt).toISOString()})`);
    }

    if (reconnectAttempts < maxReconnectAttempts) {
      delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), maxReconnectDelay);
      reconnectAttempts++;
    } else {
      delay = retryAfterMaxDelay;
      postMaxRetryCount++;

      if (!maxRetryModeAnnounced) {
        maxRetryModeAnnounced = true;
        logger.warn(`Reconnexion série non disponible après ${maxReconnectAttempts} tentatives : retries continus toutes les ${Math.round(retryAfterMaxDelay / 60000)} minute(s) (début=${new Date(reconnectStartedAt).toISOString()})`);
      } else if (postMaxRetryCount % 10 === 0) {
        logger.warn(`Toujours en attente de la balance (${postMaxRetryCount} retries en mode 1 minute, début=${new Date(reconnectStartedAt).toISOString()})`);
      }
    }

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connect().catch((err) => {
        logger.error(`Erreur inattendue lors de la reconnexion : ${err.message}`);
        scheduleReconnect();
      });
    }, delay);
  }

  async function connect() {
    cleanup();

    try {
      currentPortPath = await resolvePortPath();

      port = new SerialPort({
        path: currentPortPath,
        baudRate: config.SERIAL.baudRate,
        dataBits: config.SERIAL.dataBits,
        stopBits: config.SERIAL.stopBits,
        parity: config.SERIAL.parity,
        autoOpen: true
      });

      parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      // Gestion des événements
      port.on('open', () => {
        logger.info(`Port série ouvert sur ${currentPortPath}`);
        reconnectAttempts = 0; // Reset des tentatives
        maxRetryModeAnnounced = false;
        postMaxRetryCount = 0;
        reconnectStartedAt = null;
        clearSerialErrorState();
        notifyConnectionStatus(true);
        startPolling();

        // Demande identité du terminal
        port.write('I4\r\n', (err) => {
          if (!err) return;
          logger.error(`Erreur écriture I4 sur port série : ${err.message}`);
          notifyConnectionStatus(false);
          scheduleReconnect();
        });
      });

      port.on('error', (err) => {
        logSerialError(err);
        notifyConnectionStatus(false);
        scheduleReconnect();
      });

      port.on('close', () => {
        logger.warn(`Port série fermé (${currentPortPath || 'inconnu'})`);
        stopPolling();
        notifyConnectionStatus(false);
        scheduleReconnect();
      });

      // Gestion des données
      parser.on('data', (line) => {
        try {
          const cleaned = line
            .replace(/\x02/g, '')
            .replace(/\x03/g, '')
            .trim();

          if (!cleaned) return;

          // Identification terminal
          if (cleaned.startsWith('I4') && cleaned.includes('"')) {
            if (terminalIdentified) return;

            const match = cleaned.match(/"(.+?)"/);
            if (match) {
              const terminalCode = match[1];
              terminalIdentified = true;
              logger.info(`Terminal identifié : ${terminalCode}`);

              if (onTerminal) {
                try {
                  onTerminal(terminalCode);
                } catch (err) {
                  logger.error(`Erreur callback terminal : ${err.message}`);
                }
              }
            }
            return;
          }

          // Poids stable uniquement
          if (!cleaned.startsWith('S S')) return;

          const match = cleaned.match(/([+-]?\d+(\.\d+)?)/);
          if (!match) return;

          const weight = parseFloat(match[1]);
          if (isNaN(weight)) return;

          if (onWeight) {
            try {
              onWeight(weight);
            } catch (err) {
              logger.error(`Erreur callback poids : ${err.message}`);
            }
          }
        } catch (err) {
          logger.error(`Erreur de parsing trame série : ${err.message}`);
        }
      });

    } catch (err) {
      logSerialError(err);
      notifyConnectionStatus(false);
      scheduleReconnect();
    }
  }

  // Démarrage initial de la connexion
  connect().catch((err) => {
    logger.error(`Erreur connexion série initiale : ${err.message}`);
    notifyConnectionStatus(false);
    scheduleReconnect();
  });

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
