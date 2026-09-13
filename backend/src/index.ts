import express from 'express';

const app = express();
const port = parseInt(process.env.PORT || '8080', 10);

app.use(express.json());

app.get('/api/health/ping', (_req, res) => {
  res.status(200).end();
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`GridVault API server listening on port ${port}`);
  });
}

export { app };
