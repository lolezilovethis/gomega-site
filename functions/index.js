const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const fetch = require('node-fetch'); // or axios

admin.initializeApp();
const app = express();
app.use(express.json());

// Helper: verify Firebase ID token
async function verifyIdToken(req, res, next){
  const idToken = req.headers.authorization && req.headers.authorization.split('Bearer ')[1];
  if(!idToken) return res.status(401).json({error:'Missing auth token'});
  try{
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  }catch(e){
    console.error(e);
    return res.status(401).json({error:'Invalid auth token'});
  }
}

// Map your frontend model keys to provider models (change as needed)
const MODEL_MAP = {
  'gomega-v1':'gpt-3.5-turbo',
  'gomega-v2':'gpt-3.5-turbo',
  'gomega-v3':'gpt-4o', // example
  'gomega-v4':'gpt-4o',
  'gomega-v5':'gpt-4o' // premium mapping
};

app.post('/generate', verifyIdToken, async (req,res) => {
  try{
    const uid = req.user.uid;
    const { messages, model } = req.body;
    // 1) check license in Firestore if model is premium
    const selected = model || 'gomega-v2';
    const requirePremium = ['gomega-v4','gomega-v5'].includes(selected);
    if(requirePremium){
      // query licenses assigned to uid or check license doc matching uid
      const licenseQuery = await admin.firestore().collection('licenses')
        .where('assignedTo','==', uid).limit(1).get();
      if(licenseQuery.empty){
        return res.status(403).json({ error: 'Premium model requires an active license' });
      }
      const lic = licenseQuery.docs[0].data();
      if(lic.expiresAt !== 'lifetime' && new Date(lic.expiresAt) < new Date()){
        return res.status(403).json({ error: 'License expired' });
      }
    }

    // 2) prepare payload for your LLM provider (example: OpenAI chat completion)
    // Replace with your provider's API call. Keep the API key in Functions environment variables.
    const providerModel = MODEL_MAP[selected] || MODEL_MAP['gomega-v2'];
    const OPENAI_KEY = functions.config().openai?.key; // set via firebase functions:config:set openai.key="..."

    const body = {
      model: providerModel,
      messages: messages.map(m => ({ role: m.role, content: m.text }))
    };

    // Proxy request
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    // Extract text safely (depends on provider)
    const reply = (data?.choices && data.choices[0]?.message?.content) || (data?.error?.message) || 'No reply';
    return res.json({ reply, meta: { providerResponse: !!data }});
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

exports.api = functions.https.onRequest(app);
