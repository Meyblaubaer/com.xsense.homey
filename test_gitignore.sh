#!/bin/bash

echo "=== GITIGNORE VERIFICATION ==="
echo ""

echo "1. Dateien die IGNORIERT werden (sensible Daten):"
echo ""
echo "   Logs & Debug:"
git check-ignore *.log 2>/dev/null | wc -l | xargs | awk '{print "   - " $1 " Log-Dateien"}'
git check-ignore *.py 2>/dev/null | wc -l | xargs | awk '{print "   - " $1 " Python Debug-Skripte"}'
git check-ignore signer-debug.json 2>/dev/null && echo "   - signer-debug.json ✓"
git check-ignore .claude/settings.local.json 2>/dev/null && echo "   - .claude/settings.local.json ✓"

echo ""
echo "   Analyse-Dateien (Development):"
git check-ignore plan01.md 2>/dev/null && echo "   - plan01.md ✓"
git check-ignore refresh.md 2>/dev/null && echo "   - refresh.md ✓"
git check-ignore problems.md 2>/dev/null && echo "   - problems.md ✓"
git check-ignore TODO.md 2>/dev/null && echo "   - TODO.md ✓"
git check-ignore xsense_shadow.md 2>/dev/null && echo "   - xsense_shadow.md ✓"

echo ""
echo "   Debug Reports:"
git check-ignore DEBUG_GUIDE.md 2>/dev/null && echo "   - DEBUG_GUIDE.md ✓"
git check-ignore MQTT_ANALYSIS_REPORT.md 2>/dev/null && echo "   - MQTT_ANALYSIS_REPORT.md ✓"
git check-ignore SHADOW_TOPICS_COMPLETE.md 2>/dev/null && echo "   - SHADOW_TOPICS_COMPLETE.md ✓"

echo ""
echo "2. Dateien die BEHALTEN werden (wichtige Doku):"
echo ""
git check-ignore README.md 2>/dev/null && echo "   ❌ README.md (sollte NICHT ignoriert sein!)" || echo "   ✓ README.md wird behalten"
git check-ignore CHANGELOG.md 2>/dev/null && echo "   ❌ CHANGELOG.md (sollte NICHT ignoriert sein!)" || echo "   ✓ CHANGELOG.md wird behalten"
git check-ignore INSTALLATION.md 2>/dev/null && echo "   ❌ INSTALLATION.md (sollte NICHT ignoriert sein!)" || echo "   ✓ INSTALLATION.md wird behalten"
git check-ignore OPTIMIZATIONS_COMPLETED.md 2>/dev/null && echo "   ❌ OPTIMIZATIONS_COMPLETED.md (sollte NICHT ignoriert sein!)" || echo "   ✓ OPTIMIZATIONS_COMPLETED.md wird behalten"

echo ""
echo "3. Status Check:"
echo ""
echo "   Sensible Dateien geschützt:"
PROTECTED=$(git check-ignore *.log *.py plan*.md *debug*.json 2>/dev/null | wc -l | xargs)
echo "   $PROTECTED Dateien werden ignoriert"

echo ""
echo "   Wichtige Doku verfügbar:"
DOCS=0
git check-ignore README.md 2>/dev/null || ((DOCS++))
git check-ignore CHANGELOG.md 2>/dev/null || ((DOCS++))
git check-ignore INSTALLATION.md 2>/dev/null || ((DOCS++))
echo "   $DOCS/3 wichtige Docs werden behalten"

echo ""
echo "=== ZUSAMMENFASSUNG ==="
echo ""
if [ $DOCS -eq 3 ] && [ $PROTECTED -gt 0 ]; then
    echo "✅ .gitignore korrekt konfiguriert!"
    echo "   - Sensible Daten werden ignoriert"
    echo "   - Wichtige Dokumentation bleibt erhalten"
else
    echo "⚠️  .gitignore benötigt Überprüfung"
fi

