/**
 * ==============================================================
 * Configuration centrale du Balance Agent
 * path : app/config.js
 *
 * Ce fichier contient toutes les configurations de l'application :
 * - Connexion série à la balance
 * - URLs et authentification API serveur central
 * - Paramètres système (timers, intervalles)
 * - Configuration du serveur HTTP local
 * ==============================================================
 */

/**
 * @typedef {Object} SerialConfig
 * @property {string} path - Chemin du port série (ex: 'COM11' sur Windows, '/dev/ttyS10' sur Linux)
 * @property {boolean} autoDetect - Active la détection automatique du port balance (SICS)
 * @property {number} detectProbeTimeoutMs - Timeout de test par port lors de l'auto-détection
 * @property {number} baudRate - Vitesse de transmission en bauds (9600)
 * @property {number} dataBits - Nombre de bits de données (8)
 * @property {number} stopBits - Nombre de bits d'arrêt (1)
 * @property {string} parity - Parité ('none', 'even', 'odd', 'mark', 'space')
 */

/**
 * @typedef {Object} ApiConfig
 * @property {string} url - URL de l'API pour envoyer les poids
 * @property {string} heartbeatUrl - URL de l'API pour les heartbeats
 * @property {string} token - Token d'authentification Bearer
 */

/**
 * @typedef {Object} SystemConfig
 * @property {number} pollIntervalMs - Intervalle entre les requêtes de poids à la balance (ms)
 * @property {number} retryIntervalMs - Intervalle entre les tentatives de reconnexion (ms)
 * @property {number} zeroHeartbeatMs - Intervalle des heartbeats quand poids = 0 (ms)
 */

/**
 * @typedef {Object} LocalServerConfig
 * @property {number} port - Port du serveur HTTP local
 * @property {string} token - Token de sécurité pour l'API locale
 */

/**
 * Configuration complète de l'application Balance Agent
 * @type {{
 *   SERIAL: SerialConfig,
 *   API: ApiConfig,
 *   SYSTEM: SystemConfig,
 *   LOCAL_SERVER: LocalServerConfig
 * }}
 */
module.exports = {

  SERIAL: {
    path: 'COM73',
    autoDetect: true,
    detectProbeTimeoutMs: 2500,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  },

  API: {
    url: 'http://test-lisot.ktg.cd.glencore.net/api/scale/log',
    heartbeatUrl: 'http://test-lisot.ktg.cd.glencore.net/api/scale/heartbeat',
    token: 'a3f9b8c1d2e4f56789ab0cdef1234567890abcdef1234567890abcdef12345678'
  },

  SYSTEM: {
    pollIntervalMs: 4000,
    retryIntervalMs: 5000,
    zeroHeartbeatMs: 60000
  },

  /**
   * ============================================================
   * CONFIGURATION SERVEUR LOCAL
   * ============================================================
   */

  LOCAL_SERVER: {

    /**
     * Port du serveur local
     * L'application web lira le poids sur :
     *
     * http://localhost:1789/weight
     */
    port: 1789,

    /**
     * Token de sécurité pour accéder à l'API locale
     */
    token: "d3e2a9f1c8b7a6f5e4d3c2b1a0987654321abcdef9ab0cdef1234567890abcdef"

  }

};