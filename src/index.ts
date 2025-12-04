import express from 'express';
import { healthRouter } from './routes/health';
import { sessionMiddleware } from './middleware/session';
import cartRouter from './routes/cart';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(sessionMiddleware);

app.use('/api/cart', cartRouter);
app.use('/', healthRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;