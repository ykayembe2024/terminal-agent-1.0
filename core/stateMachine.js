/**
 * ==============================================================
 * stateMachine.js - Machine d'état pour la logique métier des poids
 * app/core/stateMachine.js
 *
 * Gestion locale de la décision d'envoyer ou non un poids
 * ==============================================================
 */

const {createRequire} = require("module");
const requireFile = createRequire(__filename);
const config = requireFile('../config');

/**
 * Machine d'état pour filtrer et décider l'envoi des poids
 * Évite les doublons et gère les intervalles pour les poids zéro
 * @class StateMachine
 */
class StateMachine {

  /**
   * Crée une instance de la machine d'état
   * @constructor
   * @param {Function} onSend - Callback appelé quand un poids doit être envoyé
   */
  constructor(onSend) {

    /**
     * Dernier état connu ('ZERO' ou 'NON_ZERO')
     * @type {string}
     */
    this.lastState = 'ZERO';

    /**
     * Timestamp du dernier ZERO envoyé
     * @type {number|null}
     */
    this.lastZeroSentAt = null;

    /**
     * Intervalle entre les envois de zéro (ms)
     * @type {number}
     */
    this.zeroInterval = config.SYSTEM.zeroHeartbeatMs;

    /**
     * Callback pour envoyer un poids
     * @type {Function}
     */
    this.onSend = onSend;
  }

  /**
   * Traite un poids et décide s'il doit être envoyé
   * @param {number} weight - Poids en kg à traiter
   * @returns {void}
   */
  process(weight) {

    const now = Date.now();

    /**
     * ------------------------------------------------------------

    const now = Date.now();

    /**
     * ------------------------------------------------------------
     * CAS 1 : POIDS NON NUL
     * ------------------------------------------------------------
     */
    if (weight !== 0) {

      this.lastState = 'NON_ZERO';
      this.lastZeroSentAt = null; // reset

      this.onSend(weight);
      return;
    }

    /**
     * ------------------------------------------------------------
     * CAS 2 : POIDS = 0
     * ------------------------------------------------------------
     */

    // 2.1 Transition NON_ZERO → ZERO
    if (this.lastState === 'NON_ZERO') {

      this.lastState = 'ZERO';
      this.lastZeroSentAt = now;

      this.onSend(0);
      return;
    }

    // 2.2 On est déjà à ZERO
    if (this.lastState === 'ZERO') {

      if (!this.lastZeroSentAt) {
        this.lastZeroSentAt = now;
        this.onSend(0);
        return;
      }

      const elapsed = now - this.lastZeroSentAt;

      if (elapsed >= this.zeroInterval) {

        this.lastZeroSentAt = now;
        this.onSend(0);
      }
    }
  }
}

module.exports = StateMachine;
