import express from 'express';

const app = express();
const port = parseInt(process.env.PORT || '9090', 10);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gridvault-witness' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`GridVault witness service listening on port ${port}`);
  });
}

export { app };
