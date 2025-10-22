const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Generate multiple phone number format variations for HubSpot contact matching
 * @param {string} phone - The phone number to generate variations for
 * @param {Object} hubspotClient - HubSpot client instance (optional, for validation)
 * @returns {Array<string>} Array of phone number format variations
 */
function generatePhoneNumberVariations(phone) {
    if (!phone) {
        throw new Error('Phone number is required');
    }

    // Ensure the input phone number has a '+' for consistent parsing
    const phoneNum = phone.includes("+") ? phone : `+${phone}`;
    const parsedNumber = parsePhoneNumberFromString(phoneNum);

    // Use a Set to automatically handle duplicate formats
    const valueSet = new Set();

    // Add the raw phone string as a fallback
    valueSet.add(phone);

    if (!parsedNumber) {
        // If parsing fails, we can only search for the raw string and a version without '+'
        console.warn(`Could not parse phone number: ${phone}. Searching with raw value.`);
        valueSet.add(phone.replace('+', ''));
    } else {
        const nationalNumber = parsedNumber.nationalNumber;
        const countryCode = parsedNumber.countryCallingCode;

        // 1. Basic E.164 and national formats
        valueSet.add(parsedNumber.number); // e.g., +12125552368
        valueSet.add(nationalNumber); // e.g., 2125552368

        // 2. Formats with and without country code/plus
        valueSet.add(`${countryCode}${nationalNumber}`); // e.g., 12125552368

        // 3. Formats with common characters (rely on the library for accuracy)
        valueSet.add(parsedNumber.format('INTERNATIONAL')); // e.g., +1 212-555-2368
        valueSet.add(parsedNumber.format('NATIONAL')); // e.g., (212) 555-2368

        // 4. Handle leading zeros
        valueSet.add(`0${nationalNumber}`);
        if (nationalNumber.startsWith('0')) {
            valueSet.add(nationalNumber.substring(1));
        }

        // 5. Country-specific formatting variations using a more systematic approach
        addCountrySpecificFormats(valueSet, parsedNumber, countryCode, nationalNumber);

        // 6. Add format variations for better HubSpot matching
        addHubSpotSpecificFormats(valueSet, parsedNumber, countryCode, nationalNumber);
    }

    let values = Array.from(valueSet);
    return values;
}





function addCountrySpecificFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    const country = parsedNumber.country;

    switch (country) {
        case 'BR':
            addBrazilianFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        case 'MX':
            addMexicanFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        case 'AR':
            addArgentinianFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        case 'CO':
            addColombianFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        case 'VE':
            addVenezuelanFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        case 'CI':
            addIvoryCoastFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        case 'ID':
            addIndonesianFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        case 'IN':
            addIndianFormats(valueSet, parsedNumber, countryCode, nationalNumber);
            break;
        default:
            // For other countries, add some common variations
            addCommonInternationalFormats(valueSet, parsedNumber, countryCode, nationalNumber);
    }
}

/**
 * Add Brazilian phone number format variations
 * Handles the 9th digit rule for mobile numbers
 */
function addBrazilianFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    if (nationalNumber.length === 10) {
        // This handles mobile numbers that might be stored without the extra '9'
        const areaCode = nationalNumber.slice(0, 2);
        const localNumber = nationalNumber.slice(2);
        const numberWithNinthDigit = `${areaCode}9${localNumber}`;

        // Create a temporary brazilian number to generate its formats
        const brParsedWithNinth = parsePhoneNumberFromString(`+${countryCode}${numberWithNinthDigit}`);
        if (brParsedWithNinth) {
            valueSet.add(brParsedWithNinth.number);
            valueSet.add(brParsedWithNinth.nationalNumber);
            valueSet.add(brParsedWithNinth.format('INTERNATIONAL'));
            valueSet.add(brParsedWithNinth.format('NATIONAL'));
        }
    }
}

/**
 * Add Mexican phone number format variations
 * Handles legacy mobile numbers with '1' prefix
 */
function addMexicanFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // Handles old format +52 1 [number] which is now just +52 [number]
    const numberWithLegacy1 = `+${countryCode}1${nationalNumber}`;
    const mxParsedWithLegacy1 = parsePhoneNumberFromString(numberWithLegacy1);
    const nationalNumberWithout1 = nationalNumber.slice(1);

    if (mxParsedWithLegacy1) {
        valueSet.add(mxParsedWithLegacy1.number);
        valueSet.add(mxParsedWithLegacy1.nationalNumber); // e.g., 15512345678
        valueSet.add(`521${nationalNumber}`);
        valueSet.add(`52${nationalNumberWithout1}`);
        valueSet.add(`+52${nationalNumberWithout1}`);
        valueSet.add(nationalNumberWithout1);
        valueSet.add(mxParsedWithLegacy1.format('INTERNATIONAL')); // e.g., +52 1 55 1234 5678
        valueSet.add(mxParsedWithLegacy1.format('NATIONAL')); // e.g., 1 55 1234 5678
    }
}

/**
 * Add Argentinian phone number format variations
 * Handles the '9' prefix for mobile numbers and '15' removal
 */
function addArgentinianFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // Argentina mobile numbers need '9' between country code and area code
    // Also need to handle '15' prefix removal
    const numberWith9 = `+${countryCode}9${nationalNumber}`;
    const arParsedWith9 = parsePhoneNumberFromString(numberWith9);

    if (arParsedWith9) {
        valueSet.add(arParsedWith9.number);
        valueSet.add(arParsedWith9.nationalNumber);
        valueSet.add(arParsedWith9.format('INTERNATIONAL'));
        valueSet.add(arParsedWith9.format('NATIONAL'));
    }

    // Handle numbers with '15' prefix that should be removed
    if (nationalNumber.startsWith('15')) {
        const numberWithout15 = nationalNumber.slice(2);
        valueSet.add(`+${countryCode}${numberWithout15}`);
        valueSet.add(`+${countryCode}9${numberWithout15}`);
        valueSet.add(numberWithout15);
    }
}

/**
 * Add Colombian phone number format variations
 * Handles carrier codes for mobile numbers
 */
function addColombianFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // Colombian mobile numbers may have carrier codes
    // Add variations without carrier codes
    if (nationalNumber.length === 10) {
        const areaCode = nationalNumber.slice(0, 3);
        const localNumber = nationalNumber.slice(3);

        // Try different carrier code variations
        const carrierCodes = ['1', '2', '3', '4', '5'];
        carrierCodes.forEach(carrier => {
            const withCarrier = `${areaCode}${carrier}${localNumber}`;
            valueSet.add(`+${countryCode}${withCarrier}`);
            valueSet.add(withCarrier);
        });
    }
}

/**
 * Add Venezuelan phone number format variations
 * Handles numbering plan changes
 */
function addVenezuelanFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // Venezuelan numbers may have undergone format changes
    // Add common variations
    if (nationalNumber.length === 7) {
        // Add area code variations
        const commonAreaCodes = ['212', '414', '416', '424', '426'];
        commonAreaCodes.forEach(areaCode => {
            valueSet.add(`+${countryCode}${areaCode}${nationalNumber}`);
            valueSet.add(`${areaCode}${nationalNumber}`);
        });
    }
}

/**
 * Add Ivory Coast phone number format variations
 * Handles the '5' prefix requirement
 */
function addIvoryCoastFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    valueSet.add(`5${nationalNumber}`);
}

/**
 * Add Indonesian phone number format variations
 * Handles variable length numbers and area codes
 */
function addIndonesianFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // Indonesian numbers can be 8-12 digits
    // Add leading zero variations
    if (!nationalNumber.startsWith('0')) {
        valueSet.add(`0${nationalNumber}`);
    }

    // Add area code variations for major cities
    const majorAreaCodes = ['21', '22', '24', '31', '341', '361'];
    majorAreaCodes.forEach(areaCode => {
        if (nationalNumber.startsWith(areaCode)) {
            const withoutAreaCode = nationalNumber.slice(areaCode.length);
            valueSet.add(withoutAreaCode);
            valueSet.add(`0${areaCode}${withoutAreaCode}`);
        }
    });
}

/**
 * Add Indian phone number format variations
 * Handles regional variations and mobile number changes
 */
function addIndianFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // Indian mobile numbers underwent changes in certain regions
    // Add variations with and without leading zeros
    if (nationalNumber.length === 10) {
        // Mobile number format
        valueSet.add(`0${nationalNumber}`);

        // Some regions had different formatting
        const mobilePrefix = nationalNumber.slice(0, 4);
        const remaining = nationalNumber.slice(4);
        valueSet.add(`${mobilePrefix} ${remaining}`);
    }
}

/**
 * Add common international format variations
 * For countries not specifically handled above
 */
function addCommonInternationalFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // Add common variations that might occur in different countries

    // With/without parentheses around area code
    const formatted = parsedNumber.format('NATIONAL');
    if (formatted.includes('(')) {
        valueSet.add(formatted.replace(/[()]/g, ''));
    }

    // With/without spaces and dashes
    valueSet.add(formatted.replace(/[\s-]/g, ''));

    // International format without plus
    const intlFormatted = parsedNumber.format('INTERNATIONAL');
    valueSet.add(intlFormatted.replace('+', ''));
    valueSet.add(intlFormatted.replace(/[\s-]/g, ''));
}

/**
 * Add HubSpot-specific format variations
 * These are formats commonly found in HubSpot due to data entry patterns
 */
function addHubSpotSpecificFormats(valueSet, parsedNumber, countryCode, nationalNumber) {
    // HubSpot users often enter numbers in various formats
    // Add common CRM-specific variations

    // Format with dots instead of dashes
    const nationalFormatted = parsedNumber.format('NATIONAL');
    valueSet.add(nationalFormatted.replace(/-/g, '.'));

    // Format with underscores
    valueSet.add(nationalFormatted.replace(/[\s-]/g, '_'));

    // Format with only country code and number (no formatting)
    valueSet.add(`${countryCode}${nationalNumber}`);

    // Format as might be copy-pasted from different sources
    valueSet.add(parsedNumber.format('INTERNATIONAL').replace(/\D/g, ''));
}

module.exports = {
    generatePhoneNumberVariations
};