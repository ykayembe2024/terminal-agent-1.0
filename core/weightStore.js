/**
 * ==============================================================
 * weightStore.js - Stockage en mémoire des données de poids actuelles
 * Stockage mémoire du dernier poids détecté
 * ==============================================================
 */

/**
 * Store singleton pour stocker les données de poids actuelles
 * Utilisé par l'API HTTP locale pour exposer le dernier poids
 * @class WeightStore
 */
class WeightStore {

  /**
   * Crée une instance du store de poids
   * @constructor
   */
  constructor() {
    /**
     * Dernier poids enregistré (kg)
     * @type {number}
     */
    this.weight = 0;

    /**
     * Timestamp ISO du dernier poids
     * @type {string|null}
     */
    this.timestamp = null;

    /**
     * Code du terminal associé
     * @type {string|null}
     */
    this.terminalCode = null;
  }

  /**
   * Met à jour le poids actuel
   * @param {number} weight - Nouveau poids en kg
   * @returns {void}
   */
  setWeight(weight) {
    this.weight = weight;
    this.timestamp = new Date().toISOString();
  }

  /**
   * Configure le code du terminal
   * @param {string} code - Code du terminal
   * @returns {void}
   */
  setTerminal(code) {
    this.terminalCode = code;
  }

  /**
   * Récupère les données actuelles de poids
   * @returns {Object} Données de poids formatées
   * @returns {string|null} return.terminal_code - Code du terminal
   * @returns {number} return.weight - Poids en kg
   * @returns {string|null} return.timestamp - Timestamp ISO
   */
  getWeight() {
    return {
      terminal_code: this.terminalCode,
      weight: this.weight,
      timestamp: this.timestamp
    };
  }

}

/**
 * Instance singleton du WeightStore
 * @type {WeightStore}
 */
module.exports = new WeightStore();