/**
 * ==============================================================
 * Balance Agent – Application principale
 * Path : balance-agent/app/app.js
 * Auteur : Yves KAYEMBE
 * ==============================================================
 */
const {createRequire} = require("module");
const requireFile = createRequire(__filename);

// Charger les variables d'environnement depuis un fichier .env (optionnel)
// Priorité d'utilisation des paramètres :
// 1) Variable d'environnement système (ex: setx /M SERIAL_PATH "COM3")
// 2) Fichier .env présent dans le répertoire de travail (SERIAL_PATH=COM3)
// 3) Valeur dans config.SERIAL.path
try {
  // En SEA, require() ne voit que les modules built-in : dotenv passe par createRequire.
  const dotenv = requireFile('dotenv');
  dotenv.config({ path: require('path').join(process.cwd(), '.env') });
} catch (err) {
  // noop - dotenv absent
}

const logger = requireFile('./core/logger');
const startReader = requireFile('./serial/reader');
const SyncService = requireFile('./core/syncService');
const StateMachine = requireFile('./core/stateMachine');
const config = requireFile('./config');
const weightStore = requireFile('./core/weightStore');
const startServer = requireFile('./server/httpServer');

let reader = null;
let localServer = null;
let isShuttingDown = false;

/**
 * Démarre l'agent de balance complet
 * Initialise serveur HTTP local, lecteur série, synchro centrale et machine d'état.
 * @async
 * @function startAgent
 * @returns {Promise<void>}
 */
async function startAgent() {

  logger.info('Démarrage du Balance Agent');
  logger.info(`API log=${config.API.url}`);
  logger.info(`API heartbeat=${config.API.heartbeatUrl}`);

  localServer = startServer();

  const syncService = new SyncService();

  const stateMachine = new StateMachine((weight) => {
    weightStore.setWeight(weight);
    syncService.send(weight);
  });

  try {
  // Permettre à l'installateur (InnoSetup) de définir le port via variable d'environnement
  // L'installateur peut écrire la variable SYSTEM-wide SERIAL_PATH ou modifier config.
    const portPath = process.env.SERIAL_PATH || config.SERIAL.path;

    // L'auto-détection série a été désactivée. L'installateur doit fournir
    // explicitement le port série (via SERIAL_PATH ou en éditant config.SERIAL.path).
    if (!portPath) {
      throw new Error('Aucun port série configuré. Fournir la variable d\'environnement SERIAL_PATH ou config.SERIAL.path');
    }

    logger.info(`Mode série: port fixe (${portPath})`);

    // Note: le 5ème argument est un callback d'erreur critique (string|null)
    // Le reader l'appelle quand un problème majeur empêche le polling.
    // On la transmet au SyncService pour inclusion dans le heartbeat.
    reader = startReader(
      portPath || null,
      (terminalCode) => {
        logger.info(`Terminal détecté : ${terminalCode}`);
        syncService.setTerminal(terminalCode);
        weightStore.setTerminal(terminalCode);
      },
      (weight) => {
        stateMachine.process(weight);
      },
      (connected) => {
        syncService.setSerialConnectionStatus(connected);
      },
      (criticalMessage) => {
        try {
          syncService.setCriticalError(criticalMessage);
        } catch (err) {
          logger.error(`Erreur setCriticalError: ${err.message}`);
        }
      }
    );

  } catch (err) {
    logger.error(`Erreur démarrage lecteur : ${err.message}`);
  }
}

/**
 * Arrête proprement le lecteur série sans propager d'exception
 * @returns {void}
 */
function stopReaderSafe() {
  if (!reader || !reader.stop) return;

  try {
    reader.stop();
  } catch (err) {
    logger.error(`Erreur arrêt lecteur série : ${err.message}`);
  }
}

/**
 * Arrête proprement le serveur HTTP local sans propager d'exception
 * @returns {void}
 */
function stopLocalServerSafe() {
  if (!localServer || !localServer.stop) return;

  try {
    localServer.stop();
  } catch (err) {
    logger.error(`Erreur arrêt serveur local : ${err.message}`);
  }
}

/**
 * Arrêt propre de l'application avec logging détaillé
 * @async
 * @function gracefulShutdown
 * @param {string} signal - Origine de l'arrêt ('SIGINT', 'SIGTERM', etc.)
 * @param {number} [exitCode=0] - Code de sortie process
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal, exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.warn(`🔄 Arrêt propre initié (${signal}) - Nettoyage en cours...`);

  try {
    stopReaderSafe();
    stopLocalServerSafe();

    await new Promise(resolve => setTimeout(resolve, 100));

    logger.warn(`✅ Arrêt propre terminé (${signal})`);
    process.exit(exitCode);
  } catch (err) {
    logger.error(`❌ Erreur lors de l'arrêt propre (${signal}): ${err.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  logger.warn('🛑 Signal SIGINT reçu - Arrêt en cours...');
  await gracefulShutdown('SIGINT', 0);
});

process.on('SIGTERM', async () => {
  logger.warn('🛑 Signal SIGTERM reçu - Arrêt en cours...');
  await gracefulShutdown('SIGTERM', 0);
});

/**
 * Gestionnaire d'exceptions non capturées
 * En mode service, on quitte pour laisser le superviseur relancer proprement.
 */
process.on('uncaughtException', async (err) => {
  const message = err?.message || 'Erreur inconnue';

  if (/GetOverlappedResult.*Operation aborted|WriteFileEx|Invalid handle/i.test(message)) {
    logger.warn(`Exception série transitoire ignorée: ${message}`);
    return;
  }

  logger.error(`Exception non capturée: ${message}`);
  logger.error(`Stack trace: ${err?.stack || 'N/A'}`);
  await gracefulShutdown('uncaughtException', 1);
});

/**
 * Gestionnaire des rejets de promesses non gérés
 * Ne tue pas le process immédiatement pour éviter les interruptions inutiles.
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Promesse rejetée non gérée: ${reason}`);
  if (promise) {
    logger.warn('Promesse concernée capturée pour diagnostic (process maintenu actif)');
  }
});

startAgent().catch(err => {
  logger.error(`Erreur fatale au démarrage : ${err.message}`);
  process.exit(1);
});
