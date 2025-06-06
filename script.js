function setCookie(name, value, days = 365) {
	const expires = new Date(Date.now() + days * 864e5).toUTCString();
	document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/';
}

function getCookie(name) {
	return document.cookie.split('; ').reduce((r, v) => {
        const parts = v.split('=');
        return parts[0] === name ? decodeURIComponent(parts[1]) : r
	}, '');
}

async function encryptAndEncode(text) {
	const publicKey = (await openpgp.key.readArmored(getCookie('pgpPublic'))).keys[0];
	const options = {
        message: openpgp.message.fromText(text),
        publicKeys: [publicKey]
	};
	const encrypted = await openpgp.encrypt(options);
	return btoa(encrypted.data);
}

async function decodeAndDecrypt(base64) {
	const encrypted = atob(base64);
	const privateKeyObj = (await openpgp.key.readArmored(getCookie('pgpPrivate'))).keys[0];
	await privateKeyObj.decrypt(getCookie('pgpPassphrase'));

	const message = await openpgp.message.readArmored(encrypted);
	const options = {
        message,
        privateKeys: [privateKeyObj]
	};
	const decrypted = await openpgp.decrypt(options);
	return decrypted.data;
}

var data_json;

async function uploadToGist(content) {
	let gistId = getCookie('gistId');
	const url = gistId
        ? `https://api.github.com/gists/${gistId}`
        : `https://api.github.com/gists`;
	const method = gistId ? 'PATCH' : 'POST';
	const body = {
        description: "PGP Encrypted Markdown",
        public: false,
        files: {
            "data.asc": {
                content: content
            }
        }
	};
	const res = await fetch(url, {
        method: method,
        headers: {
            'Authorization': `token ${getCookie('githubToken')}`,
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body)
	});
	const data = await res.json();
	if (!gistId && data.id) {
        setCookie('gistId', data.id);
        alert("New Gist created. Gist ID saved!");
	}
}

async function loadFromGist() {
	const gistId = getCookie('gistId');
	if (!gistId) return;
	const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
            'Authorization': `token ${getCookie('githubToken')}`,
            'Accept': 'application/vnd.github.v3+json'
        }
	});
	const encData = await res.json();
	const fileContent = encData.files["data.asc"].content;
	const decryptedText = await decodeAndDecrypt(fileContent);
	//console.log(decryptedText)
	setCookie("data", decryptedText)

	data_json = JSON.parse(decryptedText)
	renderTree();
}

function renderTree() {
	console.log(data_json)

        function collectDescendants(parentId, set) {
            for (const item of data_json) {
                if (item.parentId === parentId) {
                    set.add(item.id);
                    if (item.type === "folder") collectDescendants(item.id, set);
                }
            }
        }
        
        /* gives us grouped data. for example:
        {
                "root": [{ id: "folder-1", ... }],
                "folder-1": [{ id: "folder-2", ... }],
                "folder-2": [{ id: "note-1", ... }]
        } */
        const grouped = data_json.reduce((acc, item) => {
                const key = item.parentId || "root";
                if (!acc[key]) acc[key] = [];
                acc[key].push(item);
                return acc;
        }, {});

        function buildTree(parentId) {
            const items = grouped[parentId] || [];
            const ul = document.createElement("ul");

            for (const item of items) {
                    
                const title = document.createElement("span");
                title.className = "title";
                title.textContent = item.type === "folder" ? item.name : item.title;

                // [E] for editing the name of a folder or note
                const editBtn = document.createElement("span");
                editBtn.textContent = " [E]";
                editBtn.className = "edit";
                editBtn.onclick = () => {
                    const field = item.type === "folder" ? "name" : "title";
                    const newName = prompt(`Rename ${item.type}`, item[field]);
                    if (newName) {
                        item[field] = newName;
                        //uploadToGist();
                        renderTree();
                    }
                };

                // [-] button for removing the unwanted notes/folder
                const deleteBtn = document.createElement("span");
                deleteBtn.textContent = " [-]";

                deleteBtn.className = "remove";
                deleteBtn.onclick = () => {
                    if (!confirm(`Delete this ${item.type}?`)) return;

                    const idsToDelete = new Set();
                    collectDescendants(item.id, idsToDelete);
                    idsToDelete.add(item.id);

                    data_json = data_json.filter(i => !idsToDelete.has(i.id));
                    //uploadToGist();
                    renderTree();
                };

                const li = document.createElement("li");
                li.appendChild(title);
                li.appendChild(deleteBtn);
                li.appendChild(editBtn);

                if (item.type === "folder") {
                    li.className = "arrow closed";
                    // [+] button for creating note
                    const addBtn = document.createElement("span");
                    addBtn.textContent = " + ";

                    addBtn.className = "add";
                    addBtn.onclick = () => {
                        const newNote = {
                            id: "note-" + crypto.randomUUID(),
                            type: "note",
                            title: "New Note",
                            content: "# New note!\nborn to be edited, forced to be encrypted.",
                            parentId: item.id,
                            createdAt: new Date().toISOString(),
                            modifiedAt: new Date().toISOString()
                        };
                        data_json.push(newNote);
                        //uploadToGist();
                        renderTree();
                    };
                    li.appendChild(addBtn);

                    // Render children
                    const children = buildTree(item.id);
                    children.className = "collapsed";
                    if (children.childElementCount > 0) li.appendChild(children);

                    title.onclick = () => {
                        const lastc = title.parentElement.lastChild;
                        const parent = title.parentElement;
                        lastc.classList = lastc.classList=="" ? "collapsed" : "";
                        parent.classList = parent.classList=="arrow opened" ? "arrow closed" : "arrow opened";
                    }
                } else if (item.type === "note") {
                    if (item.modified) title.className = "modified";
                    li.className = "note";
                }


                ul.appendChild(li);
            }

            return ul;
        }
        const tree = document.getElementById("tree");
        tree.innerHTML = "";
        tree.appendChild(buildTree("root"));
        //uploadToGist();
	}

	

function saveConfig() {
	setCookie('githubToken', document.getElementById('githubToken').value);
	setCookie('gistId', document.getElementById('gistId').value);
	setCookie('pgpPublic', document.getElementById('pgpPublic').value);
	setCookie('pgpPrivate', document.getElementById('pgpPrivate').value);
	setCookie('pgpPassphrase', document.getElementById('pgpPassphrase').value);
	alert('Configuration saved.');
}

function loadConfig() {
	document.getElementById('githubToken').value = getCookie('githubToken');
	document.getElementById('gistId').value = getCookie('gistId');
	document.getElementById('pgpPublic').value = getCookie('pgpPublic');
	document.getElementById('pgpPrivate').value = getCookie('pgpPrivate');
	document.getElementById('pgpPassphrase').value = getCookie('pgpPassphrase');
}

async function exportConfig() {
	const password = prompt("Enter a password to encrypt your config:");
	if (!password) return;

	const config = {
        githubToken: getCookie('githubToken'),
        gistId: getCookie('gistId'),
        pgpPublic: getCookie('pgpPublic'),
        pgpPrivate: getCookie('pgpPrivate'),
        pgpPassphrase: getCookie('pgpPassphrase')
	};
	const json = JSON.stringify(config);

	const encrypted = await openpgp.encrypt({
        message: openpgp.message.fromText(json),
        passwords: [password],
        armor: true
	});

	const base64 = btoa(encrypted.data);
	const blob = new Blob([base64], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'config.txt';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

async function importConfigFile(file) {
	const password = prompt("Enter the password to decrypt your config:");
	if (!password) return;

	const reader = new FileReader();
	reader.onload = async function(e) {
        try {
            const base64 = e.target.result;
            const encrypted = atob(base64.trim());
            const message = await openpgp.message.readArmored(encrypted);
            const { data: decrypted } = await openpgp.decrypt({
                    message,
                    passwords: [password],
                    format: 'utf8'
            });
            const config = JSON.parse(decrypted);

            document.getElementById('githubToken').value = config.githubToken || '';
            document.getElementById('gistId').value = config.gistId || '';
            document.getElementById('pgpPublic').value = config.pgpPublic || '';
            document.getElementById('pgpPrivate').value = config.pgpPrivate || '';
            document.getElementById('pgpPassphrase').value = config.pgpPassphrase || '';
            saveConfig();
            loadConfig();
            alert('Configuration imported.');
        } catch (err) {
            alert('Failed to import configuration: ' + err.message);
        }
	};
	reader.readAsText(file);
}

document.getElementById('saveBtn').addEventListener('click', async () => {
	const text = document.getElementById('editor').value;
	const encrypted = await encryptAndEncode(text);
	await uploadToGist(encrypted);
	alert('Saved to GitHub Gist!');
});

document.getElementById('loadBtn').addEventListener('click', async () => {
	loadConfig();
	if (getCookie('githubToken') && getCookie('pgpPublic') && getCookie('pgpPrivate')) {
        await loadFromGist();
	} else {
        alert("Please configure before refreshing.")
	}
});

document.getElementById('saveConfig').addEventListener('click', () => {
	saveConfig();
});

document.getElementById('exportConfig').addEventListener('click', () => {
	exportConfig();
});

document.getElementById('importConfig').addEventListener('click', () => {
	document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', (event) => {
	const file = event.target.files[0];
	if (file) {
        importConfigFile(file);
	}
});

document.getElementById("saveBtn").onclick = () => {
	if (!currentNoteId) return;
	const note = jsonifiedText.find(n=>n.id === currentNoteId && n.type === "note");
	if (note) {
        note.content = document.getElementById("editor").value;
        note.modified = true;
	}
	renderTree();
};

window.onload = async () => {
	loadConfig();
	data_json = JSON.parse(getCookie("data"));
	if (data_json) {
        renderTree();
	}
	if (getCookie('githubToken') && getCookie('pgpPublic') && getCookie('pgpPrivate')) {
        await loadFromGist();
	}
};
