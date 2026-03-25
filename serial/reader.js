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
 * @param {Function} [onCriticalError] - Callback appelé quand une erreur critique série survient (message) ou null quand résolu
 * @returns {Object} Interface de contrôle { stop() }
 */
function startReader(portPath, onTerminal, onWeight, onConnectionStatus, onCriticalError) {

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
   * Flag interne : active la recherche automatique de ports (fallback)
   * après plusieurs tentatives de reconnexion échouées sur le port configuré.
   * @type {boolean}
   */
  let enableFallbackScan = false;

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
    /**
     * Retourne la configuration d'auto-détection.
     * On peut activer l'auto-détection globale via config.SERIAL.autoDetect.
     */
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
    const paths = ports.map((item) => item.path).filter(Boolean).map(p => String(p).toUpperCase());

    // Liste de ports privilégiés pour accélérer la détection (ex: COM3..COM10)
    const preferred = [];
    for (let i = 3; i <= 10; i++) preferred.push(`COM${i}`);

    const result = [];

    // 1) Ajouter le port configuré en premier s'il est fourni
    const provided = portPath ? String(portPath).toUpperCase() : null;
    if (provided) result.push(provided);

    // 2) Ajouter les ports privilégiés présents
    for (const p of preferred) {
      if (paths.includes(p) && !result.includes(p)) result.push(p);
    }

    // 3) Ajouter le reste des ports détectés
    for (const p of paths) {
      if (!result.includes(p)) result.push(p);
    }

    return result;
  }

  /**
   * Teste un port en envoyant une commande SICS I4 pour confirmer qu'il s'agit d'une balance.
   * @param {string} candidatePath - Port à tester
   * @returns {Promise<{ ok: boolean, terminalCode: string|null }>} Résultat du test
   */
  /**
   * Teste un port série pour vérifier s'il s'agit d'une balance SICS.
   * Envoie la commande I4 et lit la réponse pendant un timeout.
   * @param {string} candidatePath
   * @returns {Promise<{ok:boolean, terminalCode:string|null}>}
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
          // ignore
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
            if (cleaned.startsWith('$')) {
              // NMEA/GPS frames — ignore
              finish(false, null);
              return;
            }

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
  /**
   * Résout le port à utiliser pour la connexion active.
   * Stratégie :
   *  - si un port est fourni, on vérifie son format et on probe ce port
   *  - si le probe échoue et que config.SERIAL.fallbackDetectOnMissingPort === true,
   *    on parcourt les ports disponibles et on probe chacun jusqu'à trouver la balance
   *  - sinon on lève une erreur
   * @returns {Promise<string>} Port sélectionné
   */
  async function resolvePortPath() {
    const provided = portPath ? String(portPath).toUpperCase() : null;

    if (provided) {
      if (!/^COM\d+$/.test(provided)) {
        throw new Error(`Port série invalide: ${portPath}. Le port doit être au format COM<number> (ex: COM3)`);
      }

      // Tentative rapide : probe du port fourni
      const probeResult = await probeSicsPort(provided);
      if (probeResult.ok) {
        logger.info(`Port configuré ${provided} validé par probe${probeResult.terminalCode ? ` (terminal=${probeResult.terminalCode})` : ''}`);
        return provided;
      }

      // Si le probe a échoué :
      // - si le fallback est autorisé ET que enableFallbackScan est true (après N tentatives),
      //   on effectue la détection automatique complète
      if (config.SERIAL.fallbackDetectOnMissingPort && enableFallbackScan) {
        logger.warn(`Port configuré ${provided} invalide ou non disponible — fallback auto-détection activée`);
        const allPorts = await SerialPort.list();
        const candidates = await getCandidatePorts();

        if (!candidates.length) {
          throw new Error('Aucun port série détecté sur la machine');
        }

        logger.info(`Auto-détection série: ${candidates.length} port(s) à tester: ${candidates.join(', ')}`);

        for (const candidate of candidates) {
          const result = await probeSicsPort(candidate);
          if (result.ok) {
            logger.info(`Auto-détection série: balance trouvée sur ${candidate}${result.terminalCode ? ` (terminal=${result.terminalCode})` : ''}`);
            return candidate;
          }
        }

        const portSummary = allPorts
          .map((p) => `${p.path}${p.friendlyName ? ` (${p.friendlyName})` : ''}${p.manufacturer ? ` [${p.manufacturer}]` : ''}`)
          .join(', ') || 'aucun';

        throw new Error(`Aucun port balance SICS valide détecté. Ports disponibles: ${portSummary}`);
      }

      // Si le fallback n'est pas encore activé, on réessaie simplement le port configuré
      logger.warn(`Probe initial du port ${provided} échoué — réessai sur le même port avant fallback`);
      return provided;
    }

    // Aucun port fourni — en mode auto-detect complet on parcourra les ports
    if (!isAutoDetectEnabled()) {
      throw new Error('Aucun port série fourni. L\'installateur doit fournir le port (ex: COM3).');
    }

    const allPorts = await SerialPort.list();
    const candidates = await getCandidatePorts();

    if (!candidates.length) {
      throw new Error('Aucun port série détecté sur la machine');
    }

    logger.info(`Auto-détection série: ${candidates.length} port(s) à tester: ${candidates.join(', ')}`);

    for (const candidate of candidates) {
      const result = await probeSicsPort(candidate);
      if (result.ok) {
        logger.info(`Auto-détection série: balance trouvée sur ${candidate}${result.terminalCode ? ` (terminal=${result.terminalCode})` : ''}`);
        return candidate;
      }
    }

    const portSummary = allPorts
      .map((p) => `${p.path}${p.friendlyName ? ` (${p.friendlyName})` : ''}${p.manufacturer ? ` [${p.manufacturer}]` : ''}`)
      .join(', ') || 'aucun';

    throw new Error(`Aucun port balance SICS valide détecté. Ports disponibles: ${portSummary}`);
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
      // Notifier une erreur critique une seule fois au début
      if (onCriticalError) {
        try {
          onCriticalError(message);
        } catch (cbErr) {
          logger.error(`Erreur callback critical error : ${cbErr.message}`);
        }
      }
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
    // Notifier la résolution de l'erreur critique
    if (onCriticalError) {
      try {
        onCriticalError(null);
      } catch (cbErr) {
        logger.error(`Erreur callback critical error clear : ${cbErr.message}`);
      }
    }
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
      // Activer le fallback (scan des ports) si on dépasse le seuil configuré
      try {
        const threshold = Number(config.SERIAL.fallbackAfterRetries) || 3;
        if (!enableFallbackScan && config.SERIAL.fallbackDetectOnMissingPort && reconnectAttempts >= threshold) {
          enableFallbackScan = true;
          logger.warn(`Activation du fallback auto-détection après ${reconnectAttempts} tentatives`);
        }
      } catch (e) {
        // ignore config parsing errors
      }
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
  // Réinitialiser le fallback de scan après une ouverture réussie
  enableFallbackScan = false;
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
      // notifier l'erreur critique si possible
      if (onCriticalError) {
        try {
          onCriticalError(err.message);
        } catch (cbErr) {
          logger.error(`Erreur callback critical error (connect): ${cbErr.message}`);
        }
      }
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
