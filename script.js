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

    function addSortableEventListeners(table) {
        table.querySelectorAll('thead th').forEach(headerCell => {
            headerCell.addEventListener('click', () => {
                const tableElement = headerCell.closest('table');
                const headerIndex = Array.from(headerCell.parentElement.children).indexOf(headerCell);
                const currentIsAscending = headerCell.dataset.order === 'asc';

                // Reset other headers' indicators and order
                tableElement.querySelectorAll('thead th').forEach(th => {
                    th.dataset.order = 'asc'; // Reset order
                    th.querySelector('.sort-indicator').textContent = '';
                });

                // Set current header's order and indicator
                headerCell.dataset.order = currentIsAscending ? 'desc' : 'asc';
                headerCell.querySelector('.sort-indicator').textContent = currentIsAscending ? ' ▼' : ' ▲';

                const rows = Array.from(tableElement.querySelectorAll('tbody tr'));

                rows.sort((a, b) => {
                    const aText = a.children[headerIndex].textContent.trim();
                    const bText = b.children[headerIndex].textContent.trim();

                    if (currentIsAscending) {
                        return aText.localeCompare(bText, undefined, {numeric: true});
                    } else {
                        return bText.localeCompare(aText, undefined, {numeric: true});
                    }
                });

                const tbody = tableElement.querySelector('tbody');
                rows.forEach(row => tbody.appendChild(row)); // Re-append sorted rows
            });
        });
    }

    function displayProcessedFavorites(db) {
        const favoritesQuery = `SELECT _id, title, itemType, container FROM favorites;`;
        const drawerQuery = `SELECT _id, title, groupType FROM drawer_groups WHERE title IS NOT NULL AND title != '';`;
        const appGroupsQuery = `SELECT groupId, component FROM appgroups;`;

        try {
            // 1. Get all necessary data from DB
            const favResults = db.exec(favoritesQuery);
            const drawerResults = db.exec(drawerQuery);
            const appGroupsResults = db.exec(appGroupsQuery);

            const allItems = favResults[0].values.map(row => {
                const obj = {}; favResults[0].columns.forEach((col, i) => { obj[col] = row[i]; }); return obj;
            });
            const drawerGroupsRaw = drawerResults[0].values.map(row => {
                const obj = {}; drawerResults[0].columns.forEach((col, i) => { obj[col] = row[i]; }); return obj;
            });
            const appGroupsRaw = appGroupsResults[0].values.map(row => {
                const obj = {}; appGroupsResults[0].columns.forEach((col, i) => { obj[col] = row[i]; }); return obj;
            });

            // 2. Create lookup maps
            const groupIdToTitle = {};
            drawerGroupsRaw.forEach(g => { groupIdToTitle[g._id] = g.title; });

            const folderIdToParentTabId = {};
            const folderIdPattern = /com\.teslacoilsw\.launcher\/FOLDER:-(\d+)#.*/;
            appGroupsRaw.forEach(ag => {
                const match = ag.component.match(folderIdPattern);
                if (match) {
                    const folderContainerId = parseInt(match[1], 10);
                    const folderId = folderContainerId - 200;
                    folderIdToParentTabId[folderId] = ag.groupId; // ag.groupId is the parent tab's ID
                }
            });

            const folderMap = {};
            drawerGroupsRaw.forEach(group => {
                const specialContainerId = -200 - group._id;
                folderMap[String(specialContainerId)] = group.title;
            });
            allItems.filter(item => item.itemType === 2).forEach(folder => {
                folderMap[String(folder._id)] = folder.title || `(無名のフォルダ) (ID: ${folder._id})`;
            });

            // 3. Process and build final lists
            const getAffiliation = (containerId) => {
                if (containerId === -100) return 'デスクトップ';
                if (containerId === -101) return 'ドック';
                const folderName = folderMap[String(containerId)];
                return (folderName !== undefined) ? folderName : `不明 (ID: ${containerId})`;
            };

            apps = [];
            folders = [];

            // Process desktop/dock items
            allItems.forEach(item => {
                if ([0, 1, 6].includes(item.itemType) && item.title) {
                    apps.push({ name: item.title, affiliation: getAffiliation(item.container) });
                } else if (item.itemType === 2) {
                    folders.push({ name: folderMap[String(item._id)], affiliation: getAffiliation(item.container) });
                }
            });

            // Process drawer groups
            drawerGroupsRaw.forEach(group => {
                let affiliation;
                if (group.groupType === 'TAB_APP_GROUP') {
                    affiliation = 'アプリドロワー（タブ）';
                } else if (group.groupType === 'FOLDER_APP_GROUP') {
                    const parentTabId = folderIdToParentTabId[group._id];
                    if (parentTabId) {
                        const parentTabTitle = groupIdToTitle[parentTabId];
                        affiliation = `アプリドロワー（タブ：${parentTabTitle}）`;
                    } else {
                        affiliation = 'アプリドロワー';
                    }
                }
                if (affiliation) { // Only add drawer groups to the folder list
                    folders.push({ name: group.title, affiliation: affiliation });
                }
            });

            // 4. Sort and render
            apps.sort((a, b) => a.name.localeCompare(b.name));
            // Sort folders by a custom order, then by name
            folders.sort((a, b) => {
                const getOrder = (affiliation) => {
                    if (affiliation === 'デスクトップ') return 0;
                    if (affiliation === 'ドック') return 1;
                    if (affiliation === 'アプリドロワー（タブ）') return 2;
                    if (affiliation.startsWith('アプリドロワー（タブ：')) return 3;
                    if (affiliation === 'アプリドロワー') return 4;
                    return 5; // Other/nested folders
                };

                const orderA = getOrder(a.affiliation);
                const orderB = getOrder(b.affiliation);

                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                // If order is the same, sort by affiliation string then by name
                const affiliationCompare = a.affiliation.localeCompare(b.affiliation);
                if (affiliationCompare !== 0) return affiliationCompare;
                return a.name.localeCompare(b.name);
            });

            resultsContainer.innerHTML = '';

            if (folders.length > 0) {
                resultsContainer.appendChild(createSection('フォルダ一覧', ['フォルダ名', '所属'], folders, false));
            }
            if (apps.length > 0) {
                const appSection = createSection('アプリ・ショートカット一覧', ['名前', '所属'], apps, true);
                const note = document.createElement('p');
                note.className = 'small text-muted';
                note.textContent = '※所属が複数の場合、アプリ名は重複して表示されます。ヘッダーをクリックすると「名前」「所属」で並べ替えできます。';
                appSection.insertBefore(note, appSection.querySelector('table'));
                resultsContainer.appendChild(appSection);
            }

            if (apps.length > 0 || folders.length > 0) {
                exportContainer.style.display = 'block';
            }

        } catch (error) {
            console.error('Error processing db:', error);
            resultsContainer.innerHTML = `<div class="alert alert-danger">結果の処理中にエラーが発生しました。</div>`;
        }
    }

    function createSection(title, headers, data, isSortable = false) {
        const fragment = document.createDocumentFragment();
        const header = document.createElement('h2');
        header.className = 'mt-5';
        header.textContent = title;
        fragment.appendChild(header);
        const table = createSimpleTable(headers, data, isSortable);
        fragment.appendChild(table);

        if (isSortable) {
            addSortableEventListeners(table);
        }

        return fragment;
    }

    function createSimpleTable(headers, data, isSortable = false) {
        const table = document.createElement('table');
        table.className = 'table table-striped table-hover';
        if (isSortable) {
            table.classList.add('table-sortable');
        }

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headers.forEach((h, i) => {
            const th = document.createElement('th');
            th.textContent = h;
            if (isSortable) {
                th.dataset.column = i;
                th.dataset.order = 'asc';
                th.style.cursor = 'pointer';
                th.innerHTML += ' <span class="sort-indicator">↕</span>';
            }
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
                th { background-color: #f2f2f2; cursor: pointer; }
                h2 { margin-top: 2em; }
                th .sort-indicator { color: #ccc; float: right; }
                th[data-order='asc'] .sort-indicator, th[data-order='desc'] .sort-indicator { color: #333; }
            </style>
        `;

        const interactiveScript = `
            <script>
                ${addSortableEventListeners.toString()}

                document.addEventListener('DOMContentLoaded', () => {
                    document.querySelectorAll('.table-sortable').forEach(table => {
                        addSortableEventListeners(table);
                    });
                });
            </script>
        `;

        const htmlContent = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>Nova List Export</title>${styles}</head><body>${resultsContainer.innerHTML}${interactiveScript}</body></html>`;
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