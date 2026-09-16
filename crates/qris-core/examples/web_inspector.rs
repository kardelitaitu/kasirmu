//! Web-based QRIS inspector and tester.

use axum::{
    Router,
    extract::{DefaultBodyLimit, Multipart},
    response::{Html, Json},
    routing::{get, post},
};
use qris_core::{QrisBuilder, QrisPayload, mcc::mcc_description, nmid::NmidInfo};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

const HTML_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QRIS Inspector & Tester</title>
    <style>
        :root {
            --bg: #0f172a;
            --card: #1e293b;
            --border: #334155;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --success: #10b981;
            --danger: #ef4444;
            --code-bg: #090d16;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: var(--bg); color: var(--text); padding: 32px 16px; min-height: 100vh; }
        .container { max-width: 900px; margin: 0 auto; }
        
        header { text-align: center; margin-bottom: 32px; }
        h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; color: #fff; }
        p.subtitle { color: var(--text-muted); font-size: 15px; }

        .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
        .card-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }

        .drop-zone {
            border: 2px dashed var(--border);
            border-radius: 8px;
            padding: 40px 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
            background: rgba(15, 23, 42, 0.5);
        }
        .drop-zone:hover, .drop-zone.dragover { border-color: var(--primary); background: rgba(59, 130, 246, 0.05); }
        .drop-zone input[type="file"] { display: none; }
        .drop-zone-icon { font-size: 40px; margin-bottom: 12px; }
        .drop-zone-text { font-size: 15px; color: var(--text); font-weight: 500; }
        .drop-zone-hint { font-size: 13px; color: var(--text-muted); margin-top: 6px; }

        .input-group { margin-top: 16px; }
        textarea {
            width: 100%;
            background: var(--code-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: #38bdf8;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            padding: 12px;
            font-size: 13px;
            resize: vertical;
            min-height: 70px;
        }
        textarea:focus { outline: none; border-color: var(--primary); }

        button.btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 12px;
        }
        button.btn:hover { background: var(--primary-hover); }

        .status { padding: 12px 16px; border-radius: 6px; font-size: 14px; margin-top: 16px; display: none; }
        .status.error { background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #fca5a5; display: block; }
        .status.success { background: rgba(16, 185, 129, 0.15); border: 1px solid var(--success); color: #6ee7b7; display: block; }

        .results-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 20px; }
        @media (min-width: 768px) { .results-grid { grid-template-columns: 1fr 1fr; } }

        .data-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .data-table th, .data-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }
        .data-table th { color: var(--text-muted); width: 35%; font-weight: 500; }
        .data-table td { font-weight: 600; color: #fff; }

        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .badge.static { background: #334155; color: #cbd5e1; }
        .badge.dynamic { background: #065f46; color: #6ee7b7; }

        .preview-box { text-align: center; padding: 16px; background: #fff; border-radius: 8px; width: fit-content; margin: 0 auto; }
        .preview-box img { max-width: 240px; height: auto; display: block; }

        .raw-box {
            background: var(--code-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px;
            color: #38bdf8;
            font-family: ui-monospace, SFMono-Regular, monospace;
            font-size: 12px;
            word-break: break-all;
            margin-top: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>QRIS Inspector & Dynamic Generator</h1>
            <p class="subtitle">Inspect real QRIS stickers or generate dynamic QR with custom amounts, fees & Tag 62</p>
        </header>

        <div class="tabs">
            <button class="tab-btn active" id="tabInspectBtn" onclick="switchTab('inspect')">🔍 Inspect / Parse</button>
            <button class="tab-btn" id="tabGenerateBtn" onclick="switchTab('generate')">⚡ Dynamic Generator (Custom Fees & Tag 62)</button>
        </div>

        <!-- 1. INSPECT TAB -->
        <div id="tabInspect">
            <div class="card">
                <div class="card-title">📷 Upload QR Code Image</div>
                <div class="drop-zone" id="dropZone">
                    <div class="drop-zone-icon">🖼️</div>
                    <div class="drop-zone-text">Click or drag & drop QRIS image here</div>
                    <div class="drop-zone-hint">Supports PNG, JPEG, WebP, etc.</div>
                    <input type="file" id="fileInput" accept="image/*">
                </div>

                <div class="input-group">
                    <label>Or paste raw QRIS string directly:</label>
                    <textarea id="rawInput" placeholder="000201010211...6304XXXX"></textarea>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn" id="parseRawBtn">⚡ Parse String</button>
                        <button class="btn btn-accent" id="loadIntoGenBtn" style="display: none;" onclick="loadCurrentIntoGenerator()">📥 Send to Dynamic Generator</button>
                    </div>
                </div>

                <div id="statusBox" class="status"></div>
            </div>
        </div>

        <!-- 2. GENERATE TAB -->
        <div id="tabGenerate" style="display: none;">
            <div class="card">
                <div class="card-title">⚙️ Dynamic QRIS Generator Settings</div>
                
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
                    Enter merchant base details (or load from parsed image) and customize transaction amounts, fees, and Tag 62 metadata.
                </div>

                <div class="grid-2">
                    <div class="input-group">
                        <label>NMID (National Merchant Identifier) *</label>
                        <input type="text" id="genNmid" placeholder="ID1023000885752" value="ID1023000885752">
                    </div>
                    <div class="input-group">
                        <label>Provider GUID (Issuer)</label>
                        <input type="text" id="genGuid" placeholder="ID.CO.BANKJATIM.WWW" value="ID.CO.BANKJATIM.WWW">
                    </div>
                </div>

                <div class="grid-3" style="margin-top: 12px;">
                    <div class="input-group">
                        <label>Merchant PAN / Account No (Sub-tag 01)</label>
                        <input type="text" id="genPan" placeholder="936001140000088872" value="936001140000088872">
                    </div>
                    <div class="input-group">
                        <label>Merchant Criteria (Sub-tag 03)</label>
                        <input type="text" id="genCriteria" placeholder="UKE" value="UKE">
                    </div>
                    <div class="input-group">
                        <label>Postal Code (Tag 61)</label>
                        <input type="text" id="genPostal" placeholder="61363" value="61363">
                    </div>
                </div>

                <div class="grid-3" style="margin-top: 12px;">
                    <div class="input-group">
                        <label>Merchant Name *</label>
                        <input type="text" id="genName" placeholder="Warung Makan Sedap" value="082 PUSK TROWULAN">
                    </div>
                    <div class="input-group">
                        <label>Merchant City *</label>
                        <input type="text" id="genCity" placeholder="MOJOKERTO" value="MOJOKERTO">
                    </div>
                    <div class="input-group">
                        <label>MCC (Category Code)</label>
                        <input type="text" id="genMcc" placeholder="5812" value="9399">
                    </div>
                </div>

                <hr style="border: 0; border-top: 1px solid var(--border); margin: 20px 0;">

                <!-- Amount & Fees -->
                <div style="font-weight: 600; font-size: 15px; margin-bottom: 12px; color: #60a5fa;">💰 Transaction Amount & Fee Configuration</div>

                <div class="grid-2">
                    <div class="input-group">
                        <label>Base Transaction Amount (IDR) *</label>
                        <input type="number" id="genAmount" placeholder="50000" value="50000" oninput="updateFeeCalculation()">
                    </div>

                    <div class="input-group">
                        <label>Fee / Tip Model (Tag 55)</label>
                        <select id="genFeeType" onchange="updateFeeInputs()">
                            <option value="none">None (No fee tag)</option>
                            <option value="fixed">Fixed Fee (Tag 56)</option>
                            <option value="percent">Percentage Fee (Tag 57)</option>
                            <option value="hybrid">Hybrid (% with minimum Rp floor)</option>
                        </select>
                    </div>
                </div>

                <div class="grid-2" id="feeInputsRow" style="margin-top: 12px; display: none;">
                    <div class="input-group" id="fixedFeeGroup" style="display: none;">
                        <label id="fixedFeeLabel">Fixed Fee Amount (Rp)</label>
                        <input type="number" id="genFixedFee" placeholder="2000" value="2000" oninput="updateFeeCalculation()">
                    </div>

                    <div class="input-group" id="percentFeeGroup" style="display: none;">
                        <label id="percentFeeLabel">Percentage Fee (%)</label>
                        <input type="text" id="genPercentFee" placeholder="0.7" value="0.7" oninput="updateFeeCalculation()">
                    </div>

                    <div class="input-group" id="hybridMinGroup" style="display: none;">
                        <label>Minimum Floor Amount (Rp)</label>
                        <input type="number" id="genHybridMin" placeholder="1000" value="1000" oninput="updateFeeCalculation()">
                    </div>
                </div>

                <div id="calcPreviewBox" class="calc-preview" style="display: none;">
                    <div id="calcExplanation">-</div>
                </div>

                <hr style="border: 0; border-top: 1px solid var(--border); margin: 20px 0;">

                <!-- Tag 62 -->
                <div style="font-weight: 600; font-size: 15px; margin-bottom: 12px; color: #a78bfa;">🏷️ Additional Data Template (Tag 62)</div>

                <div class="grid-2">
                    <div class="input-group">
                        <label>Bill Number (Sub-tag 01)</label>
                        <input type="text" id="genBill" placeholder="INV-2026-001">
                    </div>
                    <div class="input-group">
                        <label>Terminal Label (Sub-tag 07)</label>
                        <input type="text" id="genTerminal" placeholder="A01" value="A01">
                    </div>
                </div>

                <div class="grid-2" style="margin-top: 12px;">
                    <div class="input-group">
                        <label>Store Label (Sub-tag 03)</label>
                        <input type="text" id="genStore" placeholder="POS-01">
                    </div>
                    <div class="input-group">
                        <label>Reference Label (Sub-tag 05)</label>
                        <input type="text" id="genRef" placeholder="REF-8899">
                    </div>
                </div>

                <button class="btn btn-accent" id="generateBtn" onclick="generateQris()" style="margin-top: 20px;">🚀 Build & Render Dynamic QRIS</button>
            </div>
        </div>

        <div id="resultCard" class="card" style="display: none;">
            <div class="card-title">🔍 Parsed QRIS Details</div>
            
            <div class="results-grid">
                <div>
                    <table class="data-table">
                        <tr>
                            <th>Initiation</th>
                            <td id="resInitiation">-</td>
                        </tr>
                        <tr>
                            <th>Issuer / Acquirer</th>
                            <td id="resIssuer" style="color: #38bdf8; font-weight: 700;">-</td>
                        </tr>
                        <tr>
                            <th>NMID</th>
                            <td id="resNmid" style="color: #60a5fa; font-family: monospace;">-</td>
                        </tr>
                        <tr>
                            <th>Merchant PAN / Account</th>
                            <td id="resPan" style="font-family: monospace;">-</td>
                        </tr>
                        <tr>
                            <th>Acquirer / Country</th>
                            <td id="resAcquirer">-</td>
                        </tr>
                        <tr>
                            <th>Merchant Name</th>
                            <td id="resMerchantName">-</td>
                        </tr>
                        <tr>
                            <th>Merchant City</th>
                            <td id="resMerchantCity">-</td>
                        </tr>
                        <tr>
                            <th>Postal Code</th>
                            <td id="resPostalCode">-</td>
                        </tr>
                        <tr>
                            <th>MCC Category</th>
                            <td id="resMcc">-</td>
                        </tr>
                        <tr>
                            <th>Currency / Amount</th>
                            <td id="resAmount">-</td>
                        </tr>
                        <tr>
                            <th>Tip / Convenience Fee</th>
                            <td id="resTip">-</td>
                        </tr>
                    </table>
                </div>

                <div>
                    <div style="font-size: 14px; font-weight: 500; color: var(--text-muted); margin-bottom: 12px; text-align: center;">Re-rendered QR Preview</div>
                    <div class="preview-box">
                        <img id="qrImg" alt="QR Code Preview">
                    </div>
                </div>
            </div>

            <div style="margin-top: 24px;">
                <div style="font-size: 14px; font-weight: 600; color: var(--text-muted);">Additional Data (Tag 62)</div>
                <table class="data-table" style="margin-top: 8px;">
                    <tr>
                        <th>Bill Number</th>
                        <td id="resBill">-</td>
                    </tr>
                    <tr>
                        <th>Terminal Label</th>
                        <td id="resTerminal">-</td>
                    </tr>
                    <tr>
                        <th>Store Label</th>
                        <td id="resStore">-</td>
                    </tr>
                    <tr>
                        <th>Reference Label</th>
                        <td id="resRef">-</td>
                    </tr>
                </table>
            </div>

            <div style="margin-top: 20px;">
                <div style="font-size: 13px; color: var(--text-muted);">Raw String Verified with CRC:</div>
                <div id="rawStringDisplay" class="raw-box"></div>
            </div>
        </div>
    </div>

    <script>
        let lastParsedData = null;

        function switchTab(tab) {
            document.getElementById('tabInspect').style.display = tab === 'inspect' ? 'block' : 'none';
            document.getElementById('tabGenerate').style.display = tab === 'generate' ? 'block' : 'none';
            document.getElementById('tabInspectBtn').className = 'tab-btn ' + (tab === 'inspect' ? 'active' : '');
            document.getElementById('tabGenerateBtn').className = 'tab-btn ' + (tab === 'generate' ? 'active' : '');
        }

        function loadCurrentIntoGenerator() {
            if (!lastParsedData) return;
            document.getElementById('genNmid').value = lastParsedData.nmid || '';
            document.getElementById('genGuid').value = lastParsedData.provider_guid || 'ID.CO.QRIS.WWW';
            
            const firstAccount = lastParsedData.merchant_accounts?.[0];
            document.getElementById('genPan').value = firstAccount?.merchant_pan || '';
            document.getElementById('genCriteria').value = firstAccount?.criteria || '';
            document.getElementById('genPostal').value = lastParsedData.postal_code || '';

            document.getElementById('genName').value = lastParsedData.merchant_name || '';
            document.getElementById('genCity').value = lastParsedData.merchant_city || '';
            document.getElementById('genMcc').value = lastParsedData.merchant_category_code || '5812';
            if (lastParsedData.additional_data?.terminal_label) {
                document.getElementById('genTerminal').value = lastParsedData.additional_data.terminal_label;
            }
            switchTab('generate');
            updateFeeCalculation();
        }

        function updateFeeInputs() {
            const feeType = document.getElementById('genFeeType').value;
            const row = document.getElementById('feeInputsRow');
            const fixedGroup = document.getElementById('fixedFeeGroup');
            const percentGroup = document.getElementById('percentFeeGroup');
            const hybridMinGroup = document.getElementById('hybridMinGroup');

            if (feeType === 'none') {
                row.style.display = 'none';
                fixedGroup.style.display = 'none';
                percentGroup.style.display = 'none';
                hybridMinGroup.style.display = 'none';
            } else if (feeType === 'fixed') {
                row.style.display = 'grid';
                fixedGroup.style.display = 'block';
                percentGroup.style.display = 'none';
                hybridMinGroup.style.display = 'none';
                document.getElementById('fixedFeeLabel').textContent = 'Fixed Fee Amount (Rp)';
            } else if (feeType === 'percent') {
                row.style.display = 'grid';
                fixedGroup.style.display = 'none';
                percentGroup.style.display = 'block';
                hybridMinGroup.style.display = 'none';
            } else if (feeType === 'hybrid') {
                row.style.display = 'grid';
                fixedGroup.style.display = 'none';
                percentGroup.style.display = 'block';
                hybridMinGroup.style.display = 'block';
            }
            updateFeeCalculation();
        }

        function updateFeeCalculation() {
            const baseAmount = Number(document.getElementById('genAmount').value) || 0;
            const feeType = document.getElementById('genFeeType').value;
            const box = document.getElementById('calcPreviewBox');
            const expl = document.getElementById('calcExplanation');

            if (feeType === 'none') {
                box.style.display = 'none';
                return;
            }

            box.style.display = 'block';
            if (feeType === 'fixed') {
                const fee = Number(document.getElementById('genFixedFee').value) || 0;
                expl.innerHTML = `💵 <b>Fixed Fee (Tag 56):</b> Rp ${fee.toLocaleString('id-ID')} &bull; Customer pays base <b>Rp ${baseAmount.toLocaleString('id-ID')}</b> + fee <b>Rp ${fee.toLocaleString('id-ID')}</b> = <b>Rp ${(baseAmount + fee).toLocaleString('id-ID')}</b>`;
            } else if (feeType === 'percent') {
                const pct = parseFloat(document.getElementById('genPercentFee').value) || 0;
                const feeCalculated = Math.ceil(baseAmount * (pct / 100));
                expl.innerHTML = `📊 <b>Percentage Fee (Tag 57):</b> ${pct}% &bull; Calculated on Rp ${baseAmount.toLocaleString('id-ID')} is <b>Rp ${feeCalculated.toLocaleString('id-ID')}</b> (rounded up)`;
            } else if (feeType === 'hybrid') {
                const pct = parseFloat(document.getElementById('genPercentFee').value) || 0;
                const minFloor = Number(document.getElementById('genHybridMin').value) || 0;
                const calculatedPct = Math.ceil(baseAmount * (pct / 100));
                const effectiveFee = Math.max(calculatedPct, minFloor);
                expl.innerHTML = `⚡ <b>Hybrid Fee Resolution:</b> ${pct}% (Rp ${calculatedPct.toLocaleString('id-ID')}) vs Min Floor (Rp ${minFloor.toLocaleString('id-ID')})<br>`
                    + `&bull; Effective Fee: <b>Rp ${effectiveFee.toLocaleString('id-ID')}</b> ${effectiveFee === minFloor && calculatedPct < minFloor ? '(Floor minimum applied)' : '(Percentage applied)'}<br>`
                    + `&bull; Tag 55 is generated as <b>Fixed Fee (Tag 56 = "${effectiveFee}")</b> so the customer's payment app reflects the exact guaranteed amount.`;
            }
        }

        async function generateQris() {
            const nmid = document.getElementById('genNmid').value.trim();
            const guid = document.getElementById('genGuid').value.trim() || 'ID.CO.QRIS.WWW';
            const name = document.getElementById('genName').value.trim();
            const city = document.getElementById('genCity').value.trim();
            const mcc = document.getElementById('genMcc').value.trim() || '5812';
            const amount = document.getElementById('genAmount').value.trim();
            const feeType = document.getElementById('genFeeType').value;

            let fee_config = { type: feeType };
            if (feeType === 'fixed') {
                fee_config.fixed_fee = document.getElementById('genFixedFee').value.trim();
            } else if (feeType === 'percent') {
                fee_config.percent_fee = document.getElementById('genPercentFee').value.trim();
            } else if (feeType === 'hybrid') {
                fee_config.percent_fee = document.getElementById('genPercentFee').value.trim();
                fee_config.min_amount = document.getElementById('genHybridMin').value.trim();
            }

            const payload = {
                nmid,
                guid,
                merchant_pan: document.getElementById('genPan').value.trim() || null,
                criteria: document.getElementById('genCriteria').value.trim() || null,
                postal_code: document.getElementById('genPostal').value.trim() || null,
                merchant_name: name,
                merchant_city: city,
                merchant_category_code: mcc,
                amount: amount || null,
                fee: fee_config,
                additional_data: {
                    bill_number: document.getElementById('genBill').value.trim() || null,
                    terminal_label: document.getElementById('genTerminal').value.trim() || null,
                    store_label: document.getElementById('genStore').value.trim() || null,
                    reference_label: document.getElementById('genRef').value.trim() || null,
                }
            };

            try {
                const res = await fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to generate QRIS');
                renderResult(data);
                resultCard.scrollIntoView({ behavior: 'smooth' });
            } catch (err) {
                alert('Generation Error: ' + err.message);
            }
        }

        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const statusBox = document.getElementById('statusBox');
        const resultCard = document.getElementById('resultCard');
        const rawInput = document.getElementById('rawInput');
        const parseRawBtn = document.getElementById('parseRawBtn');

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                uploadImage(e.dataTransfer.files[0]);
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                uploadImage(fileInput.files[0]);
            }
        });

        parseRawBtn.addEventListener('click', () => {
            const raw = rawInput.value.trim();
            if (!raw) return;
            parseString(raw);
        });

        function showStatus(msg, isError = false) {
            statusBox.textContent = msg;
            statusBox.className = 'status ' + (isError ? 'error' : 'success');
        }

        async function uploadImage(file) {
            showStatus('Decoding image and scanning QR code...', false);
            const formData = new FormData();
            formData.append('image', file);

            try {
                const res = await fetch('/api/decode', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to decode image');
                lastParsedData = data;
                renderResult(data);
                showStatus('QRIS decoded and parsed successfully!', false);
                document.getElementById('loadIntoGenBtn').style.display = 'inline-flex';
            } catch (err) {
                resultCard.style.display = 'none';
                showStatus(err.message, true);
            }
        }

        async function parseString(payload) {
            showStatus('Parsing payload string...', false);
            try {
                const res = await fetch('/api/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ payload })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to parse payload');
                lastParsedData = data;
                renderResult(data);
                showStatus('Payload verified and parsed successfully!', false);
                document.getElementById('loadIntoGenBtn').style.display = 'inline-flex';
            } catch (err) {
                resultCard.style.display = 'none';
                showStatus(err.message, true);
            }
        }

        function renderResult(data) {
            resultCard.style.display = 'block';

            const initBadge = data.initiation === 'Dynamic' 
                ? '<span class="badge dynamic">Dynamic</span>' 
                : '<span class="badge static">Static</span>';
            document.getElementById('resInitiation').innerHTML = initBadge;

            document.getElementById('resIssuer').textContent = `${data.issuer} (${data.provider_guid})`;
            document.getElementById('resNmid').textContent = data.nmid || '-';
            
            // Primary PAN
            const firstAccount = data.merchant_accounts?.[0];
            document.getElementById('resPan').textContent = firstAccount?.merchant_pan || '-';
            
            let acqText = data.country_code || 'ID';
            if (data.nmid_details) {
                acqText += ` (Acquirer: ${data.nmid_details.acquirer_code}, Merchant No: ${data.nmid_details.merchant_number})`;
            }
            if (firstAccount?.criteria) {
                acqText += ` [Criteria: ${firstAccount.criteria}]`;
            }
            document.getElementById('resAcquirer').textContent = acqText;

            document.getElementById('resMerchantName').textContent = data.merchant_name || '-';
            document.getElementById('resMerchantCity').textContent = data.merchant_city || '-';
            document.getElementById('resPostalCode').textContent = data.postal_code || '-';
            
            let mccText = data.merchant_category_code || '-';
            if (data.mcc_description) {
                mccText += ` — ${data.mcc_description}`;
            }
            document.getElementById('resMcc').textContent = mccText;

            let amountText = `${data.currency} (${data.currency === '360' ? 'IDR' : 'Unknown'})`;
            if (data.amount) {
                amountText += ` — Rp ${Number(data.amount).toLocaleString('id-ID')}`;
            } else {
                amountText += ` — [Static QR: Amount entered by customer]`;
            }
            document.getElementById('resAmount').textContent = amountText;

            document.getElementById('resTip').textContent = data.tip || 'None';

            // Tag 62
            document.getElementById('resBill').textContent = data.additional_data?.bill_number || '-';
            document.getElementById('resTerminal').textContent = data.additional_data?.terminal_label || '-';
            document.getElementById('resStore').textContent = data.additional_data?.store_label || '-';
            document.getElementById('resRef').textContent = data.additional_data?.reference_label || '-';

            // Raw and preview
            document.getElementById('rawStringDisplay').textContent = data.raw;
            document.getElementById('rawInput').value = data.raw;
            document.getElementById('qrImg').src = `data:image/png;base64,${data.qr_png_base64}`;
        }
    </script>
</body>
</html>
"#;

#[derive(Serialize)]
struct ParsedResponse {
    raw: String,
    initiation: String,
    issuer: String,
    provider_guid: String,
    nmid: String,
    nmid_details: Option<NmidInfo>,
    merchant_name: String,
    merchant_city: String,
    postal_code: Option<String>,
    merchant_category_code: String,
    mcc_description: Option<String>,
    currency: String,
    amount: Option<String>,
    tip: Option<String>,
    country_code: String,
    merchant_accounts: Vec<qris_core::MerchantAccountInfo>,
    additional_data: Option<qris_core::AdditionalData>,
    qr_png_base64: String,
}

impl ParsedResponse {
    fn from_payload(payload: QrisPayload) -> Result<Self, String> {
        let raw = payload.to_qris_string();
        let png_bytes = payload
            .to_qr_png(300)
            .map_err(|e| format!("Failed to render QR PNG: {e}"))?;
        let qr_png_base64 = base64_encode(&png_bytes);

        let issuer = payload.issuer();
        let provider_guid = payload.provider_guid().to_string();
        let nmid = payload.nmid().to_string();
        let nmid_details = NmidInfo::parse(&nmid).ok();
        let mcc_desc = mcc_description(&payload.merchant_category_code).map(ToString::to_string);

        let tip_desc = payload.tip.as_ref().map(|t| match t {
            qris_core::Tip::Fixed { amount } => format!("Fixed fee: Rp {amount}"),
            qris_core::Tip::Percentage { percent } => format!("Percentage fee: {percent}%"),
        });

        let initiation = match payload.initiation {
            qris_core::InitiationMethod::Static => "Static".to_string(),
            qris_core::InitiationMethod::Dynamic => "Dynamic".to_string(),
        };

        Ok(Self {
            raw,
            initiation,
            issuer,
            provider_guid,
            nmid,
            nmid_details,
            merchant_name: payload.merchant_name,
            merchant_city: payload.merchant_city,
            postal_code: payload.postal_code,
            merchant_category_code: payload.merchant_category_code,
            mcc_description: mcc_desc,
            currency: payload.currency,
            amount: payload.amount,
            tip: tip_desc,
            country_code: payload.country_code,
            merchant_accounts: payload.merchant_accounts,
            additional_data: payload.additional_data,
            qr_png_base64,
        })
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(CHARSET[((n >> 18) & 63) as usize] as char);
        out.push(CHARSET[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARSET[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

async fn index() -> Html<&'static str> {
    Html(HTML_PAGE)
}

#[derive(serde::Deserialize)]
struct ParsePayloadReq {
    payload: String,
}

async fn parse_handler(
    Json(req): Json<ParsePayloadReq>,
) -> Result<Json<ParsedResponse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let payload = QrisPayload::parse(&req.payload).map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    let resp = ParsedResponse::from_payload(payload).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    Ok(Json(resp))
}

async fn decode_image_handler(
    mut multipart: Multipart,
) -> Result<Json<ParsedResponse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut image_bytes: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        if let Ok(bytes) = field.bytes().await {
            image_bytes = Some(bytes.to_vec());
            break;
        }
    }

    let bytes = image_bytes.ok_or_else(|| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "No image uploaded" })),
        )
    })?;

    let payload = QrisPayload::from_bytes(&bytes).map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("QR Decode Error: {e}") })),
        )
    })?;

    let resp = ParsedResponse::from_payload(payload).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    Ok(Json(resp))
}

#[derive(Deserialize)]
struct FeeConfig {
    #[serde(rename = "type")]
    fee_type: String, // "none", "fixed", "percent", "hybrid"
    fixed_fee: Option<String>,
    percent_fee: Option<String>,
    min_amount: Option<String>,
}

#[derive(Deserialize)]
struct AdditionalDataReq {
    bill_number: Option<String>,
    terminal_label: Option<String>,
    store_label: Option<String>,
    reference_label: Option<String>,
}

#[derive(Deserialize)]
struct GenerateReq {
    nmid: String,
    guid: Option<String>,
    merchant_pan: Option<String>,
    criteria: Option<String>,
    postal_code: Option<String>,
    merchant_name: String,
    merchant_city: String,
    merchant_category_code: String,
    amount: Option<String>,
    fee: Option<FeeConfig>,
    additional_data: Option<AdditionalDataReq>,
}

async fn generate_handler(
    Json(req): Json<GenerateReq>,
) -> Result<Json<ParsedResponse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let mut builder = QrisBuilder::new()
        .nmid(req.nmid)
        .merchant_name(req.merchant_name)
        .merchant_city(req.merchant_city)
        .merchant_category_code(req.merchant_category_code);

    if let Some(guid) = req.guid {
        builder = builder.guid(guid);
    }

    if let Some(pan) = req.merchant_pan {
        if !pan.is_empty() {
            builder = builder.merchant_pan(pan);
        }
    }

    if let Some(crit) = req.criteria {
        if !crit.is_empty() {
            builder = builder.criteria(crit);
        }
    }

    if let Some(postal) = req.postal_code {
        if !postal.is_empty() {
            builder = builder.postal_code(postal);
        }
    }

    if let Some(ref amount_str) = req.amount {
        if !amount_str.is_empty() {
            builder = builder.amount(amount_str);
        }
    }

    // Handle Fee options: None, Fixed, Percent, Hybrid
    if let Some(fee) = req.fee {
        match fee.fee_type.as_str() {
            "fixed" => {
                if let Some(f) = fee.fixed_fee {
                    if !f.is_empty() {
                        builder = builder.tip_fixed(f);
                    }
                }
            }
            "percent" => {
                if let Some(p) = fee.percent_fee {
                    if !p.is_empty() {
                        builder = builder.tip_percent(p);
                    }
                }
            }
            "hybrid" => {
                // Hybrid: % fee with a minimum floor in rupiah.
                // e.g. 0.7% with min Rp 1,000.
                if let (Some(amt), Some(pct_str), Some(min_str)) =
                    (&req.amount, &fee.percent_fee, &fee.min_amount)
                {
                    if let (Ok(base_amt), Ok(min_floor)) = (
                        qris_core::amount::parse_amount(amt),
                        qris_core::amount::parse_amount(min_str),
                    ) {
                        if let Ok(pct_calculated) =
                            qris_core::amount::calculate_percentage_fee(base_amt, pct_str)
                        {
                            let effective = std::cmp::max(pct_calculated, min_floor);
                            builder = builder.tip_fixed(effective.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Additional data (Tag 62)
    if let Some(ad) = req.additional_data {
        if let Some(b) = ad.bill_number {
            if !b.is_empty() {
                builder = builder.bill_number(b);
            }
        }
        if let Some(t) = ad.terminal_label {
            if !t.is_empty() {
                builder = builder.terminal_label(t);
            }
        }
        if let Some(s) = ad.store_label {
            if !s.is_empty() {
                builder = builder.store_label(s);
            }
        }
        if let Some(r) = ad.reference_label {
            if !r.is_empty() {
                builder = builder.reference_label(r);
            }
        }
    }

    let payload = builder.build().map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    let resp = ParsedResponse::from_payload(payload).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    Ok(Json(resp))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new()
        .route("/", get(index))
        .route("/api/parse", post(parse_handler))
        .route("/api/decode", post(decode_image_handler))
        .route("/api/generate", post(generate_handler))
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3030));
    println!();
    println!("══════════════════════════════════════════════════════════");
    println!(" 🚀 QRIS Inspector & Tester is running at:");
    println!("    http://localhost:3030");
    println!("══════════════════════════════════════════════════════════");
    println!(" Upload any QRIS image or paste a payload string to test!");
    println!();

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
