document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('backupFile');
    const loadingIndicator = document.getElementById('loading');
    const resultsContainer = document.getElementById('results-container');
    const exportContainer = document.getElementById('export-container');
    const exportHtmlBtn = document.getElementById('exportHtmlBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');

    let apps = [];
    let folders = [];

    const config = {
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm`
    };

    fileInput.disabled = true;
    initSqlJs(config).then(() => fileInput.disabled = false).catch(e => {
        console.error(e);
        resultsContainer.innerHTML = `<div class="alert alert-danger">データベースライブラリの読み込みに失敗しました。</div>`;
    });

    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        loadingIndicator.style.display = 'block';
        resultsContainer.innerHTML = '';
        exportContainer.style.display = 'none';

        try {
            const zip = await JSZip.loadAsync(file);
            const dbFile = zip.file('nova.db');
            if (!dbFile) throw new Error('バックアップファイル内に nova.db が見つかりません。');

            const dbData = await dbFile.async('uint8array');
            const SQL = await initSqlJs(config);
            const db = new SQL.Database(dbData);

            displayProcessedFavorites(db);

        } catch (error) {
            console.error('Error processing backup file:', error);
            resultsContainer.innerHTML = `<div class="alert alert-danger">エラー: ${error.message}</div>`;
        } finally {
            loadingIndicator.style.display = 'none';
        }
    });

    function displayProcessedFavorites(db) {
        const favoritesQuery = `SELECT _id, title, itemType, container FROM favorites;`;
        const drawerQuery = `SELECT _id, title FROM drawer_groups WHERE title IS NOT NULL AND title != '';`;
        
        try {
            const folderMap = {};

            const drawerResults = db.exec(drawerQuery);
            if (drawerResults && drawerResults.length > 0) {
                const drawerGroups = drawerResults[0].values;
                const columns = drawerResults[0].columns;
                drawerGroups.forEach(group => {
                    const groupId = group[columns.indexOf('_id')];
                    const groupTitle = group[columns.indexOf('title')];
                    const specialContainerId = -200 - groupId;
                    folderMap[String(specialContainerId)] = groupTitle;
                });
            }

            const favResults = db.exec(favoritesQuery);
            const allItems = favResults[0].values.map(row => {
                const obj = {};
                favResults[0].columns.forEach((col, i) => { obj[col] = row[i]; });
                return obj;
            });

            allItems.filter(item => item.itemType === 2).forEach(folder => {
                folderMap[String(folder._id)] = folder.title || '(無名のフォルダ)';
            });

            const getAffiliation = (containerId) => {
                if (containerId === -100) return 'デスクトップ';
                if (containerId === -101) return 'ドック';
                const folderName = folderMap[String(containerId)];
                return (folderName !== undefined) ? folderName : `不明 (ID: ${containerId})`;
            };

            apps = [];
            folders = [];

            allItems.filter(item => [0, 1, 6].includes(item.itemType) && item.title).forEach(item => {
                apps.push({ name: item.title, affiliation: getAffiliation(item.container) });
            });

            allItems.filter(item => item.itemType === 2).forEach(item => {
                 folders.push({ name: item.title || '(無名のフォルダ)', affiliation: getAffiliation(item.container) });
            });
            if (drawerResults && drawerResults.length > 0) {
                 drawerResults[0].values.forEach(row => {
                    folders.push({ name: row[drawerResults[0].columns.indexOf('title')], affiliation: 'アプリドロワー' });
                });
            }

            apps.sort((a, b) => a.name.localeCompare(b.name));
            folders.sort((a, b) => a.name.localeCompare(b.name));

            resultsContainer.innerHTML = '';

            if (folders.length > 0) {
                resultsContainer.appendChild(createSection('フォルダ一覧', ['フォルダ名', '所属'], folders));
            }
            if (apps.length > 0) {
                resultsContainer.appendChild(createSection('アプリ・ショートカット一覧', ['名前', '所属'], apps));
            }

            if (apps.length > 0 || folders.length > 0) {
                exportContainer.style.display = 'block';
            }

        } catch (error) {
            console.error('Error processing db:', error);
            resultsContainer.innerHTML = `<div class="alert alert-danger">結果の処理中にエラーが発生しました。</div>`;
        }
    }

    function createSection(title, headers, data) {
        const fragment = document.createDocumentFragment();
        const header = document.createElement('h2');
        header.className = 'mt-5';
        header.textContent = title;
        fragment.appendChild(header);
        fragment.appendChild(createSimpleTable(headers, data));
        return fragment;
    }

    function createSimpleTable(headers, data) {
        const table = document.createElement('table');
        table.className = 'table table-striped table-hover';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        data.forEach(rowData => {
            const tr = document.createElement('tr');
            const nameCell = document.createElement('td');
            nameCell.textContent = rowData.name || rowData.フォルダ名;
            tr.appendChild(nameCell);

            const affiliationCell = document.createElement('td');
            affiliationCell.textContent = rowData.affiliation;
            tr.appendChild(affiliationCell);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
    }

    function downloadFile(content, mimeType, filename) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    exportHtmlBtn.addEventListener('click', () => {
        const styles = `
            <style>
                body { font-family: sans-serif; margin: 2em; }
                table { border-collapse: collapse; width: 100%; margin-bottom: 2em; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                h2 { margin-top: 2em; }
            </style>
        `;
        const htmlContent = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>Nova List Export</title>${styles}</head><body>${resultsContainer.innerHTML}</body></html>`;
        downloadFile(htmlContent, 'text/html', 'nova-list.html');
    });

    exportCsvBtn.addEventListener('click', () => {
        const combined = [];
        folders.forEach(f => combined.push({ 種別: 'フォルダ', 名前: f.name, 所属: f.affiliation }));
        apps.forEach(a => combined.push({ 種別: 'アプリ/ショートカット', 名前: a.name, 所属: a.affiliation }));

        if (combined.length === 0) return;

        const headers = Object.keys(combined[0]);
        let csvContent = headers.join(',') + '\n';
        combined.forEach(row => {
            const values = headers.map(header => {
                let value = row[header];
                if (typeof value === 'string' && value.includes(',')) {
                    value = `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            });
            csvContent += values.join(',') + '\n';
        });

        downloadFile(csvContent, 'text/csv;charset=utf-8;', 'nova-list.csv');
    });
});
