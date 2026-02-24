/**
 * Script Principale per Dashboard Analytics
 * Funzionalità: Parsing file, analisi campi, generazione Chart.js
 */

// Elementi DOM Principali
const uploadScreen = document.getElementById('uploadScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const loadingOverlay = document.getElementById('loadingOverlay');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');

const questionsList = document.getElementById('questionsList');
const searchQuestions = document.getElementById('searchQuestions');
const totalQuestionsBadge = document.getElementById('totalQuestionsBadge');

const kpiTotalRows = document.getElementById('kpiTotalRows');
const kpiTotalCols = document.getElementById('kpiTotalCols');
const kpiCompletion = document.getElementById('kpiCompletion');

const primaryVariable = document.getElementById('primaryVariable');
const crossVariable = document.getElementById('crossVariable');
const chartTypeSelector = document.getElementById('chartTypeSelector');

const chartTitle = document.getElementById('chartTitle');
const variableTypeBadge = document.getElementById('variableTypeBadge');
const tableHeader = document.getElementById('tableHeader');
const tableBody = document.getElementById('tableBody');

// Variabili globali di stato
let globalData = [];        // Dati grezzi estratti dal file
let columnsInfo = {};       // Metadati su ogni colonna (tipo, valori unici, ecc.)
let chartInstance = null;   // Istanza Chart.js attiva
let currentPrimary = null;
let currentCross = null;

// Colori per i grafici (palette predefinita dashboard)
const colorPalette = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
    '#64748b', '#84cc16', '#14b8a6', '#6366f1'
];
const colorPaletteWithOpacity = colorPalette.map(c => c + 'CC'); // Opacità all'80%

// === EVENT HANDLERS UPLOAD FILE ===

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// Funzione reset
document.getElementById('resetAppBtn').addEventListener('click', () => {
    uploadScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
    fileInput.value = '';
    globalData = [];
    columnsInfo = {};
    if (chartInstance) chartInstance.destroy();
});

// Download PNG e PDF
document.getElementById('downloadPngBtn').addEventListener('click', () => {
    const canvas = document.getElementById('mainChart');
    const link = document.createElement('a');
    link.download = `grafico_${currentPrimary || 'export'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
});

document.getElementById('downloadPdfBtn').addEventListener('click', () => {
    const element = document.getElementById('reportArea');
    const opt = {
        margin: 0.5,
        filename: 'report_analisi.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
    };
    html2pdf().set(opt).from(element).save();
});


// === GESTIONE E PARSING DEL FILE ===

// Auto-Load Data dal Config all'avvio
document.addEventListener("DOMContentLoaded", () => {
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.autoLoadFile) {
        loadingOverlay.classList.remove('hidden');
        fetch(APP_CONFIG.autoLoadFile)
            .then(res => {
                if (!res.ok) throw new Error("File preimpostato non trovato");
                return res.arrayBuffer();
            })
            .then(buffer => {
                setTimeout(() => processExcelArrayBuffer(buffer), 100);
            })
            .catch(err => {
                console.log("Nessun file predefinito caricato. Attendo caricamento manuale.", err);
                loadingOverlay.classList.add('hidden');
            });
    }
});

function handleFile(file) {
    if (!file) return;

    // Mostriamo overlay caricamento
    loadingOverlay.classList.remove('hidden');

    // Usiamo un setTimeout per far renderizzare l'overlay al browser prima di bloccare il thread
    setTimeout(() => {
        const reader = new FileReader();
        reader.onload = function (e) {
            processExcelArrayBuffer(e.target.result);
        };
        reader.onerror = () => {
            alert("Errore caricamento file locale");
            loadingOverlay.classList.add('hidden');
        };
        reader.readAsArrayBuffer(file);
    }, 100);
}

function processExcelArrayBuffer(arrayBuffer) {
    try {
        const data = new Uint8Array(arrayBuffer);
        // Leggiamo il workbook
        const workbook = XLSX.read(data, { type: 'array' });
        // Prendiamo il primo foglio
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // 1. Leggiamo come array di righe per ispezionare il formato "doppia colonna"
        let rawArray = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

        // Filtriamo righe completamente vuote
        rawArray = rawArray.filter(row => row && row.length > 0 && row.some(c => String(c).trim() !== ""));

        if (rawArray.length < 2) {
            alert("Il file sembra essere vuoto o contenere solo intestazioni.");
            loadingOverlay.classList.add('hidden');
            return;
        }

        // Identifichiamo la riga delle intestazioni usando un sistema a punti "intelligente":
        // Questo impedisce che venga selezionata una riga contenente solo numeri corti (es. gli ID 1, 3, 5...)
        // Diamo un alto valore alle righe che contengono stringhe di testo più lunghe (es. le vere frasi delle domande).
        let headerRowIndex = 0;
        let maxScore = -1;

        for (let i = 0; i < Math.min(rawArray.length, 10); i++) {
            let row = rawArray[i] || [];
            let score = 0;

            for (let c = 0; c < row.length; c++) {
                let val = String(row[c] || "").trim();
                if (val !== "") {
                    score += 1; // Punti per colonna semplicemente riempita
                    // Se non è un numero puro ed è un testo esplicativo, premiamo molto di più questa riga
                    if (isNaN(Number(val)) && val.length > 3) {
                        score += 3;
                    }
                }
            }

            if (score > maxScore) {
                maxScore = score;
                headerRowIndex = i;
            }
        }

        let headersRaw = rawArray[headerRowIndex];
        let maxCols = Math.max(...rawArray.map(r => r.length));

        // Assicuriamoci che ogni colonna abbia un nome univoco copiandolo dal TESTO esatto della cella (es: "1. Sesso", "2. Quanti anni hai?")
        let uniqueHeaders = [];
        let seen = {};
        for (let c = 0; c < maxCols; c++) {
            let h = headersRaw[c];
            let headerStr = (h !== undefined && h !== null) ? String(h).trim() : "";

            // Se la riga di intestazione avesse una cella vuota per errore in quella colonna
            if (headerStr === "") {
                headerStr = "Colonna " + (c + 1);
            }

            let newH = headerStr;
            if (seen[newH]) {
                seen[newH]++;
                newH = newH + " (" + seen[newH] + ")";
            } else {
                seen[newH] = 1;
            }
            uniqueHeaders.push(newH);
        }

        // Generiamo il dataset per i grafici
        // Dalla riga successiva in poi: associamo ogni cella al titolo ESATTO della sua colonna (es. Maschio -> 1. Sesso)
        let rawJson = [];
        for (let i = headerRowIndex + 1; i < rawArray.length; i++) {
            let obj = {};
            let row = rawArray[i];
            let rowHasData = false;

            for (let c = 0; c < uniqueHeaders.length; c++) {
                let cellValue = row[c] !== undefined ? row[c] : "";
                obj[uniqueHeaders[c]] = cellValue;
                if (String(cellValue).trim() !== "") {
                    rowHasData = true;
                }
            }

            if (rowHasData) {
                rawJson.push(obj);
            }
        }

        if (rawJson.length === 0) {
            throw new Error("Nessun dato trovato oltre alle intestazioni.");
        }

        processData(rawJson);

        // Nascondiamo form e overlay, mostriamo dashboard
        uploadScreen.classList.add('hidden');
        loadingOverlay.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');

    } catch (error) {
        console.error("ERRORE DI PARSING:", error);
        alert("Errore durante la lettura del file. Verifica che sia un file Excel o CSV valido.\nDettaglio errore: " + error.message);
        loadingOverlay.classList.add('hidden');
    }
}

// === ANALISI E CLASSIFICAZIONE DATI ===

function processData(data) {
    globalData = data;
    const totalRows = data.length;
    // Identifichiamo tutte le colonne guardando tutte le chiavi possibili (in caso alcune prime righe siano disallineate)
    const columnsSet = new Set();
    data.forEach(row => {
        Object.keys(row).forEach(k => columnsSet.add(k));
    });
    const columns = Array.from(columnsSet);

    let totalCells = 0;
    let filledCells = 0;

    // Struttura dati info columns
    columnsInfo = {};

    columns.forEach(col => {
        // Estraiamo tutti i valori non vuoti per questa colonna
        let values = data.map(r => r[col]).filter(v => v !== undefined && v !== null && String(v).trim() !== "");

        totalCells += totalRows;
        filledCells += values.length;

        // Statistiche base
        let uniqueVals = [...new Set(values)];

        // --- Algoritmo determinazione TIPO variabile ---
        let type = 'testo'; // default

        const numValues = values.length;
        if (numValues > 0) {
            // Conta quanti sono trasformabili in numero valido
            const numericCount = values.filter(v => !isNaN(Number(v)) && String(v).trim() !== "").length;
            const numericRatio = numericCount / numValues;

            // Check risposte multiple (es: "Opzione A, Opzione B")
            // Spesso separate da virgole o punto e virgola
            const containsSeparators = values.some(v => typeof v === 'string' && (v.includes(',') || v.includes(';')));
            // Se unica/total è alto, ma se splitto diminuiscono drasticamente, è mul-choice.
            // Semplifichiamo: se contiene span separatori e > limitazioni categoriali

            if (numericRatio >= 0.8) {
                type = 'numerico';
            }
            else if (uniqueVals.length <= 30 || uniqueVals.length < (totalRows * 0.1)) {
                // Se poche risposte diverse, è Categorica (es: Maschio/Femmina, Si/No, o Scale 1-5 se prese come stringa)
                type = 'categorico';
            }
            else if (containsSeparators && typeof values[0] === 'string') {
                type = 'multiplo';
            }
        }

        columnsInfo[col] = {
            id: col,
            name: col,
            type: type,
            values: values,
            uniqueCount: uniqueVals.length,
            uniqueVals: uniqueVals
        };
    });

    // Filtriamo via le colonne errate (es. quelle con zero valori non vuoti) per una pulizia ulteriore
    let activeColumns = columns.filter(col => columnsInfo[col].values.length > 0);

    // Sistema automatico e invisibile di estrazione delle probabili VERE "Domande"
    // Questo sistema esclude le colonne "tecniche" (solo una-due parole brevissime) ed etichette descrittive base che non sono i veri quesiti
    const questionColumns = activeColumns.filter(col => {
        // Stringa della domanda ripulita
        const str = String(col).trim();
        const lower = str.toLowerCase();

        // Se contiene espressamente un punto interrogativo ci entra di diritto a prescindere
        if (str.includes('?')) return true;

        // Blacklist assoluta: alcune colonne molto specifiche solitamente non sono domande
        const blacklist = ["id", "nome", "cognome", "email", "e-mail", "timestamp", "data", "ora", "indirizzo", "telefono"];
        if (blacklist.includes(lower)) return false;

        // Altrimenti contiamo le parole (separando per spazi)
        const wordCount = str.split(/\s+/).filter(w => w.length > 0).length;

        // Se la stringa ha più di 3 parole (e supera almeno 12 caratteri) è *estremamente probabile* sia una domanda descrittiva del questionario
        if (wordCount >= 3 && str.length > 12) return true;

        return false;
    });

    // Sicurezza: se per puro miracolo le domande fossero tutte brevissime (0 trovate col filtro), 
    // resettiamo tutto alla normalità e gliele facciamo vedere tutte per impedire che la dashboard "sparisca"
    if (questionColumns.length > 0 && questionColumns.length <= activeColumns.length) {
        activeColumns = questionColumns;
    }

    // Ricalcoliamo le celle riempite solo per le colonne definitivamente selezionate
    filledCells = 0;
    activeColumns.forEach(col => {
        filledCells += columnsInfo[col].values.length;
    });

    // Popoliamo UI KPIs
    kpiTotalRows.innerText = totalRows;
    kpiTotalCols.innerText = activeColumns.length;
    kpiCompletion.innerText = ((filledCells / (totalRows * activeColumns.length)) * 100).toFixed(1) + "%";

    populateSidebarAndSelects(activeColumns);
}

function populateSidebarAndSelects(columns) {
    // Selezioniamo solo le prime N domande se specificato nel Config
    let displayColumns = columns;
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.maxQuestionsToShow) {
        const limite = parseInt(APP_CONFIG.maxQuestionsToShow);
        if (!isNaN(limite) && limite > 0 && limite < columns.length) {
            displayColumns = columns.slice(0, limite);
        }
    }

    totalQuestionsBadge.innerText = displayColumns.length;

    // Svuotiamo 
    questionsList.innerHTML = '';
    primaryVariable.innerHTML = '';

    // Manteniamo default null per cross
    crossVariable.innerHTML = '<option value="">-- Nessun incrocio (Analisi singola) --</option>';

    displayColumns.forEach((col, index) => {
        // Creazione elemento riga piatto per la singola domanda
        const li = document.createElement('li');

        // Assegniamo il testo della domanda come titolo, visualizzando icone semplici
        li.innerHTML = `<span><i class="fa-solid fa-chart-simple"></i></span> ${col}`;
        li.title = col; // Visualizza il testo intero on hover in caso di troncature CSS
        li.className = 'sidebar-question-item';

        // Comportamento click per calcolare e mostrare il grafico direttamente
        li.onclick = () => {
            selectPrimaryVariable(col, li);
        };

        questionsList.appendChild(li);

        // Select Options (Per topbar controls)
        const opt1 = document.createElement('option');
        opt1.value = col;
        opt1.innerText = col;
        primaryVariable.appendChild(opt1);

        // Selezionabile per Cross solo se categorico o multiplo ristretto
        if (columnsInfo[col].type === 'categorico' && columnsInfo[col].uniqueCount <= 15) {
            const opt2 = document.createElement('option');
            opt2.value = col;
            opt2.innerText = col;
            crossVariable.appendChild(opt2);
        }
    });

    // Seleziona la prima in automatico all'avvio
    if (displayColumns.length > 0) {
        const firstLi = questionsList.querySelector('li');
        if (firstLi) firstLi.click();
    }
}

// Ricerca sidebar
searchQuestions.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    Array.from(questionsList.children).forEach(li => {
        if (li.innerText.toLowerCase().includes(term)) {
            li.style.display = 'block';
        } else {
            li.style.display = 'none';
        }
    });
});

// Event listeners UI tendine
primaryVariable.addEventListener('change', (e) => selectPrimaryVariable(e.target.value));
crossVariable.addEventListener('change', (e) => renderChart(currentPrimary, e.target.value));
chartTypeSelector.addEventListener('change', () => renderChart(currentPrimary, currentCross));

function selectPrimaryVariable(colName, liElement = null) {
    currentPrimary = colName;
    primaryVariable.value = colName;

    // Aggiorna active state nella sidebar list
    Array.from(document.querySelectorAll('.questions-list li')).forEach(li => li.classList.remove('active'));

    if (liElement) {
        liElement.classList.add('active');
        // Scroll per renderlo visibile solo se è fuori vista
        liElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        // Cerca il li da cliccare se l'evento è stato un cambio select generico
        const allLis = Array.from(document.querySelectorAll('.questions-list li'));
        for (let li of allLis) {
            // Togliamo il tag span e ci basiamo sul text node o title
            if (li.title === colName || li.innerText.trim().endsWith(colName.trim())) {
                li.classList.add('active');
                li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                break;
            }
        }
    }

    // Resetta cross variable se uguale a primary (evitare incroci assurdi uguali)
    if (crossVariable.value === colName) {
        crossVariable.value = '';
    }

    renderChart(currentPrimary, crossVariable.value);
}

// === GENERAZIONE CHART JS ===

function renderChart(colId, crossColId = "") {
    currentCross = crossColId;
    const info = columnsInfo[colId];
    if (!info) return;

    // Update UI headers
    chartTitle.innerText = colId;

    // Traduciamo tipo
    let typeLabel = "Testo (Oltre 30 valori unici)";
    if (info.type === 'categorico') typeLabel = "Categorico (Scelta Singola)";
    else if (info.type === 'numerico') typeLabel = "Numerico Quantitativo";
    else if (info.type === 'multiplo') typeLabel = "Multiplo (Comuni Separatori)";

    variableTypeBadge.innerText = `Tipo Elaborazione: ${typeLabel}`;
    variableTypeBadge.className = 'badge badge-info';
    if (info.type === 'numerico') variableTypeBadge.classList.replace('badge-info', 'badge-success');

    // Default target chart type
    let requestedRenderType = chartTypeSelector.value;
    let actualType = requestedRenderType;

    let chartData = null;
    let chartOptions = null;
    let computedTableData = []; // Array di obj per la tabella

    // Distinguiamo logica Singola Variabile vs Cross Analysis
    if (!crossColId) {
        // --- ANALISI SINGOLA ---

        let labelCounter = {};

        // Funzione obbligatoria per normalizzare
        function normalizeValue(value) {
            if (value === undefined || value === null) return "";
            return value
                .toString()
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/:$/, '');
        }

        // Calcolo similarità (Distanza di Levenshtein) per capire se due risposte sono > 90% uguali
        function getSimilarity(s1, s2) {
            if (s1 === s2) return 1.0;
            if (s1.length === 0 || s2.length === 0) return 0.0;
            let v0 = new Array(s2.length + 1);
            let v1 = new Array(s2.length + 1);
            for (let i = 0; i < v0.length; i++) v0[i] = i;
            for (let i = 0; i < s1.length; i++) {
                v1[0] = i + 1;
                for (let j = 0; j < s2.length; j++) {
                    const cost = (s1[i] === s2[j]) ? 0 : 1;
                    v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
                }
                for (let j = 0; j < v0.length; j++) v0[j] = v1[j];
            }
            const maxLength = Math.max(s1.length, s2.length);
            return (maxLength - v0[s2.length]) / maxLength;
        }

        if (info.type === 'multiplo') {
            let normalizedCounts = {};
            let casingCounts = {};

            info.values.forEach(v => {
                const parts = String(v).split(/[,;]/).map(s => s.trim()).filter(s => s !== "");
                parts.forEach(p => processAndGroupValue(p, normalizedCounts, casingCounts));
            });
            finalizeCounting(normalizedCounts, casingCounts, labelCounter);
        }
        else if (info.type === 'numerico') {
            // Facciamo dei binnings (istogrammi)
            const nums = info.values.map(v => Number(v)).filter(v => !isNaN(v));
            if (nums.length === 0) return; // fail safe

            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const range = max - min;
            let bins = 5; // default bins
            if (range > 10) bins = 10;
            if (info.uniqueCount < 10) {
                // Se pochi numerici (es anni, o voto 1-10) usiamo freq unica anziché bin
                nums.forEach(n => labelCounter[n] = (labelCounter[n] || 0) + 1);
            } else {
                // Calcolo Histogram Bins
                const binSize = range / bins;
                let binGroups = Array(bins).fill(0);
                let binLabels = [];
                for (let i = 0; i < bins; i++) {
                    const bStart = min + (i * binSize);
                    let bEnd = min + ((i + 1) * binSize);
                    if (i === bins - 1) bEnd += 0.001; // fix upper bound eq
                    binLabels.push(`${bStart.toFixed(1)} - ${bEnd.toFixed(1)}`);

                    nums.forEach(n => {
                        if (n >= bStart && n < bEnd) binGroups[i]++;
                    });
                }
                binLabels.forEach((lb, i) => { labelCounter[lb] = binGroups[i]; });
            }
        }
        else {
            // Categorico o Testo -> Usiamo il sistema di raggruppamento e similarità
            let normalizedCounts = {};
            let casingCounts = {};

            info.values.forEach(v => processAndGroupValue(v, normalizedCounts, casingCounts));
            finalizeCounting(normalizedCounts, casingCounts, labelCounter);
        }

        // Funzione helper per raggruppare i valori normalizzati e trovare similitudini nei testi
        function processAndGroupValue(rawValue, normCountsMap, casingCountsMap) {
            const normV = normalizeValue(rawValue);
            if (normV === "") return;

            const originalVString = String(rawValue).trim();
            let matchedNormKey = normV;
            let foundMatch = false;

            if (normCountsMap[normV] !== undefined) {
                foundMatch = true;
            } else {
                for (let existingKey in normCountsMap) {
                    if (getSimilarity(existingKey, normV) > 0.90) {
                        matchedNormKey = existingKey;
                        foundMatch = true;
                        break;
                    }
                }
            }

            if (!foundMatch) {
                normCountsMap[matchedNormKey] = 0;
                casingCountsMap[matchedNormKey] = {};
            }

            normCountsMap[matchedNormKey]++;
            casingCountsMap[matchedNormKey][originalVString] = (casingCountsMap[matchedNormKey][originalVString] || 0) + 1;
        }

        // Funzione helper per preparare i dati definitivi da mostrare sul grafico (labelCounter)
        function finalizeCounting(normCountsMap, casingCountsMap, targetLabelCounter) {
            for (let normK in normCountsMap) {
                let bestOriginal = "";
                let maxC = -1;
                // Trova come la stringa era scritta maggiormente dall'utente prima del normale
                for (let origKey in casingCountsMap[normK]) {
                    if (casingCountsMap[normK][origKey] > maxC) {
                        maxC = casingCountsMap[normK][origKey];
                        bestOriginal = origKey;
                    }
                }
                // Migliora l'estetica se è tutto minuscolo (capitalizza la prima lettera per pulizia)
                if (bestOriginal === bestOriginal.toLowerCase() && bestOriginal.length > 0) {
                    bestOriginal = bestOriginal.charAt(0).toUpperCase() + bestOriginal.slice(1);
                }
                targetLabelCounter[bestOriginal] = normCountsMap[normK];
            }
        }

        // Sort per numerosità decrescente (salvo Numerico con label come numeri)
        let labels = Object.keys(labelCounter);
        let dataCounts = [];

        if (info.type === 'numerico' && Object.keys(labelCounter)[0].includes('-')) {
            // Mantieni ordine naturale dei bin
            dataCounts = labels.map(l => labelCounter[l]);
        } else if (info.type === 'numerico') {
            // Ordina numericamente
            labels.sort((a, b) => Number(a) - Number(b));
            dataCounts = labels.map(l => labelCounter[l]);
        } else {
            // Ordina per count decrescente (Top K)
            labels.sort((a, b) => labelCounter[b] - labelCounter[a]);
            // Limitiamo a Top 25 per i chart troppo grandi se Testo
            if (labels.length > 25) {
                const otherSums = labels.slice(25).reduce((acc, val) => acc + labelCounter[val], 0);
                labels = labels.slice(0, 25);
                labels.push('Altri');
                dataCounts = labels.map(l => l === 'Altri' ? otherSums : labelCounter[l]);
            } else {
                dataCounts = labels.map(l => labelCounter[l]);
            }
        }

        const totalItemsCount = dataCounts.reduce((acc, v) => acc + v, 0);

        // Prepariamo JSON per la tabella sottostante
        computedTableData = labels.map((lb, idx) => ({
            Valore: lb,
            Conteggio: dataCounts[idx],
            Percentuale: totalItemsCount > 0 ? ((dataCounts[idx] / totalItemsCount) * 100).toFixed(1) + '%' : '0%'
        }));

        // Determinazione renderType effettivo
        actualType = requestedRenderType;
        if (actualType === 'auto') {
            if (info.type === 'categorico') actualType = 'pie';
            else actualType = 'bar'; // numerico e multiplo meglio a barra
        }

        // Setup ChartData locale o globale
        chartData = {
            labels: labels,
            datasets: [{
                label: 'Risposte',
                data: dataCounts,
                backgroundColor: actualType === 'pie' || actualType === 'doughnut' ? colorPaletteWithOpacity : colorPaletteWithOpacity[0],
                borderColor: actualType === 'pie' || actualType === 'doughnut' ? colorPalette : colorPalette[0],
                borderWidth: 1
            }]
        };

        chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: actualType === 'pie' || actualType === 'doughnut',
                    position: 'right',
                    labels: { color: getComputedStyle(document.body).getPropertyValue('--text-main').trim() }
                },
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold' },
                    formatter: (value, ctx) => {
                        if (actualType !== 'pie' && actualType !== 'doughnut') return null; // mostriamo solo su torte per non affollare
                        let sum = 0;
                        let dataArr = ctx.chart.data.datasets[0].data;
                        dataArr.map(data => sum += data);
                        let percentage = (value * 100 / sum).toFixed(1) + "%";
                        // Nascondi label se troppo piccola
                        if (percentage === "0.0%" || value < (sum * 0.05)) return "";
                        return percentage;
                    }
                }
            }
        };

        if (actualType === 'horizontalBar') {
            actualType = 'bar';
            chartOptions.indexAxis = 'y'; // orizzontale in chartjs v3/v4
        }

    } else {
        // --- ANALISI INCROCIATA (CROSS VARIABLE) ---
        const crossInfo = columnsInfo[crossColId];

        // Es: Primario "Soddisfazione" (Da 1 a 5), Secondario "Genere" (M/F)
        // Vogliamo contare freq(Soddisfazione) RAGGRUPPATO per Genere

        let crossCategories = crossInfo.uniqueVals.slice(0, 10); // Limitiamo le categorie secondarie max a 10
        let primaryDictAgg = {}; // { 'CategoriaPrimaria': { 'M': 10, 'F': 15 } }

        globalData.forEach(row => {
            let pVal = String(row[colId] || "").trim();
            let cVal = String(row[crossColId] || "").trim();

            if (!pVal || !cVal) return; // skip celle vuote nell'incrocio

            if (!primaryDictAgg[pVal]) primaryDictAgg[pVal] = {};
            primaryDictAgg[pVal][cVal] = (primaryDictAgg[pVal][cVal] || 0) + 1;
        });

        const pLabels = Object.keys(primaryDictAgg).slice(0, 20); // limitiamo a 20 label primarie

        const datasets = crossCategories.map((cName, idx) => {
            return {
                label: String(cName),
                data: pLabels.map(pName => primaryDictAgg[pName][cName] || 0),
                backgroundColor: colorPaletteWithOpacity[idx % colorPalette.length],
                borderColor: colorPalette[idx % colorPalette.length],
                borderWidth: 1
            }
        });

        // ComputedTable data (per semplificare, tabella mostra solo totali primari qui, o nested. Facciamo multi-column)
        tableHeader.innerHTML = `<th>${colId}</th>` + crossCategories.map(c => `<th>${c}</th>`).join('');
        tableBody.innerHTML = pLabels.map(pLabel => {
            return `<tr>
                <td>${pLabel}</td>
                ${crossCategories.map(c => `<td>${primaryDictAgg[pLabel][c] || 0}</td>`).join('')}
            </tr>`;
        }).join('');

        actualType = requestedRenderType;
        if (actualType === 'auto' || actualType === 'pie' || actualType === 'doughnut') actualType = 'bar'; // Forza barra

        chartData = {
            labels: pLabels,
            datasets: datasets
        };

        chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top', labels: { color: '#fff' } },
                datalabels: { display: false } // Rimuovi percentuali in stacked
            },
            scales: {
                x: { stacked: false, ticks: { color: '#94a3b8' } },
                y: { stacked: false, ticks: { color: '#94a3b8' } }
            }
        };

        if (actualType === 'horizontalBar') {
            actualType = 'bar';
            chartOptions.indexAxis = 'y';
        }
    }

    // Distruzione chart precedente
    if (chartInstance) {
        chartInstance.destroy();
    }

    // Registra plugin Datalabels solo se non globale (in Chart.js 4 si registra globalmente o per istanza)
    Chart.register(ChartDataLabels);

    const formatActualType = chartOptions.indexAxis === 'y' ? 'bar' : chartData.datasets.length > 1 ? 'bar' : (requestedRenderType === 'auto' ? (chartOptions.indexAxis === 'y' ? 'bar' : 'bar') : requestedRenderType.replace('horizontalBar', 'bar')); // override fail safe

    // Fallback detection logic
    let canvasChartType = actualType === 'horizontalBar' ? 'bar' : actualType;
    if (canvasChartType === 'auto') {
        canvasChartType = info.type === 'categorico' ? 'pie' : 'bar';
    }

    // Creazione Chart
    const ctx = document.getElementById('mainChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: canvasChartType,
        data: chartData,
        options: chartOptions
    });

    // Aggiornamento Tabella (solo per singola var)
    if (!crossColId) {
        tableHeader.innerHTML = `
            <th>Valore Scelto</th>
            <th>Conteggio Totale</th>
            <th>Incidenza (%)</th>
        `;
        tableBody.innerHTML = computedTableData.map(row => `
            <tr>
                <td><strong>${row.Valore}</strong></td>
                <td>${row.Conteggio}</td>
                <td><span class="badge badge-info">${row.Percentuale}</span></td>
            </tr>
        `).join('');
    }
}
