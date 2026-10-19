import express from 'express';
import { getPublicStatus } from '../controllers/publicController.js';

const router = express.Router();

// No protect middleware here, it's public
router.get('/status/:slug', getPublicStatus);

export default router;
