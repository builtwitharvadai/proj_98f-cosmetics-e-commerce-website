import express from 'express';
import { healthRouter } from './routes/health';
import { sessionMiddleware } from './middleware/session';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(sessionMiddleware);

app.use('/', healthRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;