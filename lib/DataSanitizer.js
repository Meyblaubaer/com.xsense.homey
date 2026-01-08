'use strict';

/**
 * Helper class to sanitize and normalize data from X-Sense API/MQTT
 * Handles type conversions (String -> Int, String -> Bool) safely.
 */
class DataSanitizer {

    /**
     * Convert value to boolean
     * Handles: 1, "1", true, "true", "on", "yes" -> true
     * All else -> false (unless defaultValue is provided)
     */
    static toBool(value, defaultValue = false) {
        if (value === undefined || value === null) return defaultValue;
        if (typeof value === 'boolean') return value;

        const str = String(value).toLowerCase().trim();
        if (str === '1' || str === 'true' || str === 'on' || str === 'yes') return true;
        if (str === '0' || str === 'false' || str === 'off' || str === 'no') return false;

        return defaultValue;
    }

    /**
     * Convert value to integer
     */
    static toInt(value, defaultValue = 0) {
        if (value === undefined || value === null) return defaultValue;
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    /**
     * Convert value to float/number
     */
    static toFloat(value, defaultValue = 0.0) {
        if (value === undefined || value === null) return defaultValue;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    /**
     * Ensure value is a string
     */
    static toString(value, defaultValue = '') {
        if (value === undefined || value === null) return defaultValue;
        return String(value).trim();
    }

    /**
     * Sanitize Volume (0-100)
     */
    static sanitizeVolume(value) {
        const vol = this.toInt(value, 101); // 101 as invalid marker
        if (vol < 0) return 0;
        if (vol > 100) return 100;
        return vol;
    }
}

module.exports = DataSanitizer;
