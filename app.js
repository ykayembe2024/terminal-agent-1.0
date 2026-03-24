/**
 * ==============================================================
 * Balance Agent – Application principale
 * Path : balance-agent/app/app.js
 * Auteur : Yves KAYEMBE
 * ==============================================================
 */
const {createRequire} = require("module");
const requireFile = createRequire(__filename);

const logger = requireFile('./core/logger');
const startReader = requireFile('./serial/reader');
const SyncService = requireFile('./core/syncService');
const StateMachine = requireFile('./core/stateMachine');
const config = requireFile('./config');

/**
 * 🆕 nouveaux modules
 */
const weightStore = requireFile('./core/weightStore');
const startServer = requireFile('./server/httpServer');

let reader = null;

/**
 * Démarre l'agent de balance complet
 * Initialise tous les composants : serveur HTTP, lecteur série, services de synchronisation
 * et machine d'état pour le traitement des poids
 *
 * @async
 * @function startAgent
 * @returns {Promise<void>}
 * @throws {Error} Si le port série n'est pas configuré ou si l'initialisation échoue
 */
async function startAgent() {

  logger.info('Démarrage du Balance Agent');

  /**
   * 🆕 démarrage serveur local
   */
  startServer();

  const syncService = new SyncService();

  const stateMachine = new StateMachine((weight) => {

    /**
     * 🆕 stocker le poids pour l’API locale
     */
    weightStore.setWeight(weight);

    /**
     * envoi serveur central
     */
    syncService.send(weight);

  });

  try {

    // ✅ UTILISER path ET PAS port
    const portPath = config.SERIAL.path;

    if (!portPath) {
      throw new Error('config.SERIAL.path est non défini');
    }

    /**
     * Démarrage du lecteur série avec callbacks
     * @param {string} portPath - Chemin du port série (ex: COM11)
     * @param {Function} onTerminal - Callback appelé quand le terminal est identifié
     * @param {Function} onWeight - Callback appelé pour chaque poids détecté
     * @param {Function} onConnectionStatus - Callback appelé quand l'état de connexion change
     */
    reader = startReader(
      portPath,

      /**
       * Callback: terminal identifié
       * Configure le service de synchro et stocke localement
       * @param {string} terminalCode - Code unique du terminal (ex: "C150168653")
       */
      (terminalCode) => {

        logger.info(`Terminal détecté : ${terminalCode}`);

        syncService.setTerminal(terminalCode);

        /**
         * 🆕 stocker terminal localement
         */
        weightStore.setTerminal(terminalCode);
      },

      /**
       * Callback: nouveau poids reçu du port série
       * Traite le poids via la machine d'état
       * @param {number} weight - Poids en kg détecté par la balance
       */
      (weight) => {

        /**
         * logique métier
         */
        stateMachine.process(weight);

      },

      /**
       * Callback: état de connexion série changé
       * Met à jour l'état dans le service de synchro pour le heartbeat
       * @param {boolean} connected - true si connecté, false si déconnecté
       */
      (connected) => {

        syncService.setSerialConnectionStatus(connected);

      }
    );

  } catch (err) {

    logger.error(`Erreur démarrage lecteur : ${err.message}`);

  }

}

/**
 * ==============================================================
 * gestion des exceptions fatales
 * ==============================================================
 */

/**
 * Gestionnaire d'exceptions non capturées
 * Log l'erreur et arrête proprement l'application
 * @param {Error} err - L'exception non capturée
 */
process.on('uncaughtException', err => {

  logger.error(`Exception fatale : ${err.message}`);

  if (reader && reader.stop) {
    reader.stop();
  }

  process.exit(1);

});

/**
 * ==============================================================
 * gestion des signaux d'arrêt
 * ==============================================================
 */

/**
 * Arrêt propre de l'application avec logging détaillé
 * @async
 * @function gracefulShutdown
 * @param {string} signal - Signal qui a déclenché l'arrêt ('SIGINT', 'SIGTERM', etc.)
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal) {
  logger.warn(`🔄 Arrêt propre initié (${signal}) - Nettoyage en cours...`);

  try {
    // Arrêt du lecteur série
    if (reader && reader.stop) {
      logger.info('⏹️  Arrêt du lecteur série...');
      reader.stop();
    }

    // Attendre un court instant pour permettre la fermeture propre
    await new Promise(resolve => setTimeout(resolve, 100));

    logger.warn(`✅ Arrêt propre terminé (${signal})`);
    process.exit(0);
  } catch (err) {
    logger.error(`❌ Erreur lors de l'arrêt propre (${signal}): ${err.message}`);
    process.exit(1);
  }
}

/**
 * Gestionnaire du signal SIGINT (Ctrl+C)
 * Arrêt propre demandé par l'utilisateur
 */
process.on('SIGINT', async () => {
  logger.warn('🛑 Signal SIGINT reçu - Arrêt en cours...');
  await gracefulShutdown('SIGINT');
});

/**
 * Gestionnaire du signal SIGTERM
 * Arrêt propre demandé par le système
 */
process.on('SIGTERM', async () => {
  logger.warn('🛑 Signal SIGTERM reçu - Arrêt en cours...');
  await gracefulShutdown('SIGTERM');
});

/**
 * Gestionnaire pour les exceptions non capturées
 */
process.on('uncaughtException', (err) => {
  logger.error(`Exception non capturée: ${err.message}`);
  logger.error(`Stack trace: ${err.stack}`);

  if (reader && reader.stop) {
    reader.stop();
  }

  process.exit(1);
});

/**
 * Gestionnaire pour les rejets de promesses non gérés
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Promesse rejetée non gérée: ${reason}`);

  if (reader && reader.stop) {
    reader.stop();
  }

  process.exit(1);
});

/**
 * ==============================================================
 * démarrage agent
 * ==============================================================
 */

// Démarrage de l'application
startAgent().catch(err => {
  logger.error(`Erreur fatale au démarrage : ${err.message}`);
  process.exit(1);
});