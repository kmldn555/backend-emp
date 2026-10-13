import { Router } from 'express';
import { uploadSingleImage } from '../config/multer.js';
import { EventController } from '../controllers/event.controller.js';

const eventRoutes = Router();

eventRoutes.post('/', uploadSingleImage, EventController.create);
eventRoutes.get('/', EventController.getAll);
eventRoutes.get('/:id', EventController.getById);

export { eventRoutes };