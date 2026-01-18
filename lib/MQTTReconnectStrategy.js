'use strict';

/**
 * MQTT Reconnect Strategy with Exponential Backoff
 *
 * Prevents connection storms by gradually increasing reconnect delays.
 * Resets delay on successful connection.
 */
class MQTTReconnectStrategy {
  constructor(options = {}) {
    this.minDelay = options.minDelay || 1000;        // 1 second
    this.maxDelay = options.maxDelay || 60000;       // 1 minute
    this.multiplier = options.multiplier || 2;       // Exponential factor
    this.jitter = options.jitter !== undefined ? options.jitter : 0.1; // 10% random jitter
    
    this.currentDelay = this.minDelay;
    this.attemptCount = 0;
  }

  /**
   * Get next reconnect delay with exponential backoff
   * @returns {number} Delay in milliseconds
   */
  getNextDelay() {
    this.attemptCount++;
    
    // Calculate base delay with exponential backoff
    let delay = Math.min(
      this.minDelay * Math.pow(this.multiplier, this.attemptCount - 1),
      this.maxDelay
    );
    
    // Add random jitter to prevent thundering herd
    if (this.jitter > 0) {
      const jitterAmount = delay * this.jitter;
      delay += (Math.random() * 2 - 1) * jitterAmount;
    }
    
    this.currentDelay = Math.max(this.minDelay, Math.floor(delay));
    return this.currentDelay;
  }

  /**
   * Reset strategy after successful connection
   */
  reset() {
    this.currentDelay = this.minDelay;
    this.attemptCount = 0;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      currentDelay: this.currentDelay,
      attemptCount: this.attemptCount,
      nextDelay: this.getNextDelay()
    };
  }
}

module.exports = MQTTReconnectStrategy;
