const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('scripts')); // serves static JSON files

// Update view count
app.post('/update-view-count', (req, res) => {
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  // Convert title to file-friendly format
  const filename = `${title.toLowerCase().replace(/\s+/g, '-')}.json`;
  const filePath = path.join(__dirname, 'scripts', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Script not found' });
  }

  // Read, update, and save the script JSON
  const script = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  script.views = (script.views || 0) + 1;
  fs.writeFileSync(filePath, JSON.stringify(script, null, 2));

  res.json({ success: true, views: script.views });
});

app.listen(PORT, () => {
  console.log(`✅ Gomega backend running on http://localhost:${PORT}`);
});
