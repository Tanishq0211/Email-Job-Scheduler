import "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
    }

    interface Request {
      requestId?: string;
      user?: Express.User;
    }
  }
}

export {};
