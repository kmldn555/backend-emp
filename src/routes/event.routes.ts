import { Router } from 'express';
import { uploadSingleImage } from '../config/multer.js';
import { createEventController, getEventByIdController, getEventsController } from '../controllers/event.controller.js';


const eventRoutes = Router();

eventRoutes.post('/', uploadSingleImage, createEventController);
eventRoutes.get('/', getEventsController);
eventRoutes.get('/:id', getEventByIdController);

export { eventRoutes };