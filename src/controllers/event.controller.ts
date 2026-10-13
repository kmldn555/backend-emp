import { Request, Response } from 'express';
import { uploadToCloudinary } from '../config/cloudinary.js';
import { createEventService, findEventByIdService, findEventsService } from '../services/event.service.js';

export const createEventController = async (req: Request, res: Response) => {
  try {
    const organizerId = (req as any).user?.id || 1; // Fallback jika auth belum terpasang

    if (!req.file) {
      return res.status(400).json({ message: 'Thumbnail file is required.' });
    }

    if (!req.body.data) {
      return res.status(400).json({ message: 'Payload data is required.' });
    }

    // Parsing payload form-data yang dikirim sebagai JSON string
    const parsedPayload =
      typeof req.body.data === 'string'
        ? JSON.parse(req.body.data)
        : req.body.data;

    // Upload buffer ke Cloudinary
    const thumbnailUrl = await uploadToCloudinary(req.file.buffer, 'events');

    // Panggil fungsi service secara langsung
    const createdEvent = await createEventService(
      organizerId,
      parsedPayload,
      thumbnailUrl
    );

    return res.status(201).json({
      message: 'Event and tickets successfully created.',
      data: createdEvent,
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Kode voucher sudah digunakan.' });
    }
    return res.status(500).json({ message: error.message || 'Internal Server Error' });
  }
};

export const getEventsController = async (req: Request, res: Response) => {
  try {
    const { search, categoryId, location, page, limit } = req.query;

    const result = await findEventsService({
      search: search as string,
      categoryId: categoryId ? Number(categoryId) : undefined,
      location: location as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 12,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal Server Error' });
  }
};

export const getEventByIdController = async (req: Request, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    if (isNaN(eventId)) {
      return res.status(400).json({ message: 'Invalid Event ID format.' });
    }

    const event = await findEventByIdService(eventId);

    if (!event) {
      return res.status(404).json({ message: 'Event not found.' });
    }

    return res.status(200).json({ data: event });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal Server Error' });
  }
};