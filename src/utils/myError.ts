export default class MyError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;

    Object.setPrototypeOf(this, MyError.prototype);

    this.name = "MyError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MyError);
    }
  }
}

export function isMyError(error: unknown): error is MyError {
  return error instanceof MyError;
}
