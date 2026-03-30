// Quick patch: V7.9.1 — fix false positive capital garanti detection
// The "100% du capital initial" pattern matches in ALL autocalls
// (payout description), not just capital-guaranteed products.
// Must check for "Protection du capital : Non" as override.

(function() {
    'use strict';

    // Wait for aiParser to exist, then patch parseBrochure
    var _patchInterval = setInterval(function() {
        if (typeof aiParser === 'undefined' || !aiParser.parseBrochure) return;
        
        var _origParse = aiParser.parseBrochure.bind(aiParser);
        if (_origParse._capGarantiFix) return;

        aiParser.parseBrochure = async function(rawText) {
            var parsed = await _origParse(rawText);
            
            var txtLower = rawText.toLowerCase();
            
            // Check for explicit "Protection du capital : Non" or "pas de garantie en capital"
            var hasExplicitNoProtection = 
                /protection\s*du\s*capital\s*[:=]?\s*non/i.test(rawText) ||
                txtLower.indexOf('pas de garantie en capital') >= 0 ||
                txtLower.indexOf('pas de garantie, ni en cours de vie, ni') >= 0 ||
                txtLower.indexOf('risque de perte en capital partielle ou totale en cours de vie et à l\'échéance') >= 0 ||
                txtLower.indexOf('risque de perte en capital partielle ou totale en cours de vie et à la date d\'échéance') >= 0 ||
                /perte\s*en\s*capital[^.]{0,30}totale[^.]{0,30}(?:en\s*cours\s*de\s*vie|à\s*l'échéance|à\s*la\s*date)/i.test(rawText);

            if (hasExplicitNoProtection && parsed.capitalProtection) {
                // Product explicitly says NO capital protection
                if (parsed.capitalProtection.level === 100 || parsed.capitalProtection.protected === true) {
                    // Check if there's a real barrier — if barrier exists, it's NOT capital garanti
                    var barrier = parseFloat(parsed.capitalProtection.barrier) || 0;
                    if (barrier > 0 && barrier < 100) {
                        parsed.capitalProtection.protected = false;
                        parsed.capitalProtection.level = null;
                        console.log('[pdf V7.9.1] Capital garanti FALSE POSITIVE fixed — product says "Protection du capital: Non" with barrier=' + barrier + '%');
                        
                        // Also fix structureType if it was set to capital_garanti
                        if (parsed.structureType === 'capital_garanti') {
                            parsed.structureType = 'autocall';
                        }
                    }
                }
            }

            // Also check: if capitalProtection.barrier < 100 exists, it's NOT a capital garanti
            // (capital garanti means barrier=null or barrier=0 or level=100)
            if (parsed.capitalProtection && parsed.capitalProtection.level === 100) {
                var b = parseFloat(parsed.capitalProtection.barrier) || 0;
                if (b > 0 && b < 100) {
                    // Has a real loss barrier → NOT capital garanti
                    parsed.capitalProtection.protected = false;
                    parsed.capitalProtection.level = null;
                    console.log('[pdf V7.9.1] Capital garanti overridden — has loss barrier at ' + b + '%');
                }
            }
            
            return parsed;
        };
        aiParser.parseBrochure._capGarantiFix = true;
        
        clearInterval(_patchInterval);
        console.log('[StructBoard] pdf V7.9.1 capital garanti false positive fix active');
    }, 300);

    setTimeout(function() { clearInterval(_patchInterval); }, 15000);
})();
