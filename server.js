// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if(!fs.existsSync(INVOICES_FILE)) fs.writeFileSync(INVOICES_FILE, JSON.stringify({}));

function readInvoices(){ try { return JSON.parse(fs.readFileSync(INVOICES_FILE,'utf8')||'{}'); } catch(e){ return {}; } }
function writeInvoices(obj){ fs.writeFileSync(INVOICES_FILE, JSON.stringify(obj, null, 2)); }

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// respond to OPTIONS (CORS preflight friendly)
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  res.sendStatus(204);
});

// Serve invoice page for /invoice/:id
app.get('/invoice/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'invoice.html'));
});

// Create invoice
app.post('/api/create-invoice', (req, res) => {
  const { plan, billing, email, amount, method } = req.body;
  if(!plan || !email || !amount) return res.status(400).json({ message: 'Missing fields (plan, email, amount required)' });

  const invoices = readInvoices();
  const invoiceId = (randomUUID().replace(/-/g, '').slice(0,12)).toUpperCase();
  invoices[invoiceId] = {
    id: invoiceId,
    plan,
    billing,
    email,
    method,
    amount: Number(amount),
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  writeInvoices(invoices);

  // in prod: send invoice email here
  res.json({ invoiceId });
});

// Get invoice
app.get('/api/invoice/:id', (req, res) => {
  const invoices = readInvoices();
  const inv = invoices[req.params.id];
  if(!inv) return res.status(404).json({ message: 'Invoice not found' });
  res.json(inv);
});

// Admin: mark paid (protect with ADMIN_TOKEN env var)
app.post('/api/admin/mark-paid', (req, res) => {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
  if(ADMIN_TOKEN){
    const token = req.header('x-admin-token');
    if(!token || token !== ADMIN_TOKEN) return res.status(403).json({ message: 'Forbidden: invalid admin token' });
  }
  const { invoiceId } = req.body;
  if(!invoiceId) return res.status(400).json({ message: 'Missing invoiceId' });

  const invoices = readInvoices();
  const inv = invoices[invoiceId];
  if(!inv) return res.status(404).json({ message: 'Invoice not found' });

  inv.status = 'paid';
  inv.paidAt = new Date().toISOString();
  writeInvoices(invoices);

  // TODO: provision premium to user here
  res.json({ ok: true, invoice: inv });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));
