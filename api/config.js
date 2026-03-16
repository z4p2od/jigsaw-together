export default function handler(req, res) {
  res.json({
    apiKey:      process.env.FIREBASE_API_KEY,
    authDomain:  process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DB_URL,
    projectId:   process.env.FIREBASE_PROJECT_ID,
  });
}
