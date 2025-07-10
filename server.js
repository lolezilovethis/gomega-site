const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public')); // Optional: serve frontend
app.use('/scripts', express.static(path.join(__dirname, 'scripts'))); // Serve scripts JSON folder

// Update view count for a specific script
app.post('/update-view-count', (req, res) => {
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const filename = `${title.toLowerCase().replace(/\s+/g, '-')}.json`;
  const filePath = path.join(__dirname, 'scripts', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Script not found' });
  }

  try {
    const script = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    script.views = (script.views || 0) + 1;
    fs.writeFileSync(filePath, JSON.stringify(script, null, 2));
    return res.json({ success: true, views: script.views });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update views.' });
  }
});

// Save new script file
app.post('/scripts/:filename', (req, res) => {
  const filename = req.params.filename.replace(/[^a-z0-9\\-\\.]/gi, '');
  const filePath = path.join(__dirname, 'scripts', filename);

  fs.writeFile(filePath, JSON.stringify(req.body, null, 2), err => {
    if (err) {
      return res.status(500).json({ error: 'Failed to save script file.' });
    }
    return res.json({ success: true, file: filename });
  });
});

// Update scripts/index.json with new entry
app.post('/update-index', (req, res) => {
  const { filename } = req.body;
  const indexPath = path.join(__dirname, 'scripts', 'index.json');

  if (!filename) {
    return res.status(400).json({ error: 'Filename is required.' });
  }

  try {
    let indexData = [];
    if (fs.existsSync(indexPath)) {
      indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }

    if (!indexData.includes(filename)) {
      indexData.push(filename);
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    }

    return res.json({ success: true, index: indexData });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update index.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Gomega backend running at: http://localhost:${PORT}`);
});
