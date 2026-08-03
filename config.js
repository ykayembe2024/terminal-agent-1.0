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
    path: 'COM3',
      // L'auto-détection peut être activée. En production, on préfère que
      // l'installateur fournisse le port, mais on peut activer un fallback
      // pour essayer de détecter automatiquement la balance si le port fourni
      // est absent.
      autoDetect: true,
      /**
       * Si true et si le port configuré est indisponible, l'agent fera un
       * scan et tentera d'identifier la balance automatiquement (fallback).
       */
      fallbackDetectOnMissingPort: true,
    /**
     * Nombre de tentatives de reconnexion sur le port configuré avant
     * d'activer le fallback de détection automatique des ports.
     * Exemple: 3 -> après 3 tentatives sur le port configuré, on scannera
     * les ports disponibles pour tenter de retrouver la balance.
     */
    fallbackAfterRetries: 3,
    detectProbeTimeoutMs: 2500,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  },

  API: (() => {
    // Une seule base LISO pour heartbeat + poids (surchargeable via env).
    // CORS local n'envoie rien au serveur : c'est bien ces URLs qui doivent pointer vers prod.
    const apiBase = String(
      process.env.API_BASE_URL
      || process.env.SCALE_API_BASE
      || 'http://liso.ktg.cd.glencore.net'
    ).trim().replace(/\/+$/, '');

    return {
      url: String(process.env.API_URL || `${apiBase}/api/scale/log`).trim(),
      heartbeatUrl: String(process.env.API_HEARTBEAT_URL || `${apiBase}/api/scale/heartbeat`).trim(),
      token: String(
        process.env.API_TOKEN
        || process.env.SCALE_API_TOKEN
        || 'a3f9b8c1d2e4f56789ab0cdef1234567890abcdef1234567890abcdef12345678'
      ).trim()
    };
  })(),

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