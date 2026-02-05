import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { logStructured } from "./structured-logger";

interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.requestId;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let error = "Internal Server Error";

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "string") {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === "object" && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || message;
        error = (resp.error as string) || exception.name;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    const logExtra = {
      context: AllExceptionsFilter.name,
      requestId,
      method: request.method,
      path: request.url,
      statusCode,
      message,
      error,
      ...(statusCode >= 500 && exception instanceof Error && exception.stack
        ? { stack: exception.stack }
        : {}),
    };

    if (statusCode >= 500) {
      logStructured.error(`${request.method} ${request.url} ${statusCode} - ${message}`, logExtra);
    } else {
      logStructured.warn(`${request.method} ${request.url} ${statusCode} - ${message}`, logExtra);
    }

    response.status(statusCode).json(errorResponse);
  }
}
