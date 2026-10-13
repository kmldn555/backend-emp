import { Request, Response } from 'express';
import { EventService } from '../services/event.service.js';
import { uploadToCloudinary } from '../config/cloudinary.js';

export class EventController {
  static async create(req: Request, res: Response) {
    try {
      const organizerId = (req as any).user?.id || 1; // Fallback for session/JWT
      if (!req.file) {
        return res.status(400).json({ message: 'Thumbnail file is required.' });
      }

      const parsedPayload = JSON.parse(req.body.data);
      const thumbnailUrl = await uploadToCloudinary(req.file.buffer, 'events-emp');
      const createdEvent = await EventService.createEvent(organizerId, parsedPayload, thumbnailUrl);

      return res.status(201).json({
        message: 'Event and tickets successfully created.',
        data: createdEvent,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  static async getAll(req: Request, res: Response) {
    try {
      const { search, categoryId, location, page, limit } = req.query;
      const result = await EventService.findEvents({
        search: search as string,
        categoryId: categoryId ? Number(categoryId) : undefined,
        location: location as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 12,
      });
      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  }

  static async getById(req: Request, res: Response) {
    try {
      const event = await EventService.findEventById(Number(req.params.id));
      if (!event) return res.status(404).json({ message: 'Event not found.' });
      return res.status(200).json({ data: event });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  }
}