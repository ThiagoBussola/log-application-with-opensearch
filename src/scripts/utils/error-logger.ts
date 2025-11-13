import * as fs from "fs";
import * as path from "path";

export interface ErrorLogEntry {
  timestamp: string;
  errorType:
    | "insertion"
    | "stream"
    | "connection"
    | "serialization"
    | "unknown";
  source: string;
  message: string;
  details?: {
    documentId?: string;
    document?: any;
    batchIndex?: number;
    errorCode?: string;
    stackTrace?: string;
    opensearchError?: {
      type: string;
      reason: string;
    };
  };
}

export class ErrorLogger {
  private errors: ErrorLogEntry[] = [];
  private readonly logFilePath: string;
  private readonly maxErrorsInMemory: number = 1000;

  constructor(logDir: string = "./logs", filename?: string) {
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFilePath = path.join(
      logDir,
      filename || `errors-${timestamp}.json`
    );
  }

  logInsertionError(
    source: string,
    message: string,
    details: {
      documentId?: string;
      document?: any;
      batchIndex?: number;
      opensearchError?: { type: string; reason: string };
    }
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      errorType: "insertion",
      source,
      message,
      details: {
        documentId: details.documentId,
        document: details.document,
        batchIndex: details.batchIndex,
        opensearchError: details.opensearchError,
      },
    });
  }

  logStreamError(
    source: string,
    message: string,
    error: Error,
    details?: { document?: any }
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      errorType: "stream",
      source,
      message,
      details: {
        document: details?.document,
        stackTrace: error.stack,
        errorCode: error.name,
      },
    });
  }

  logConnectionError(source: string, message: string, error: Error): void {
    this.log({
      timestamp: new Date().toISOString(),
      errorType: "connection",
      source,
      message,
      details: {
        stackTrace: error.stack,
        errorCode: error.name,
      },
    });
  }

  logSerializationError(
    source: string,
    message: string,
    error: Error,
    details?: { document?: any }
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      errorType: "serialization",
      source,
      message,
      details: {
        document: details?.document,
        stackTrace: error.stack,
        errorCode: error.name,
      },
    });
  }

  private log(entry: ErrorLogEntry): void {
    this.errors.push(entry);

    // Prevent memory overflow - flush if too many errors
    if (this.errors.length >= this.maxErrorsInMemory) {
      this.flush();
    }
  }

  flush(): void {
    if (this.errors.length === 0) {
      return;
    }

    try {
      const existingErrors: ErrorLogEntry[] = fs.existsSync(this.logFilePath)
        ? JSON.parse(fs.readFileSync(this.logFilePath, "utf-8"))
        : [];

      const allErrors = [...existingErrors, ...this.errors];
      fs.writeFileSync(
        this.logFilePath,
        JSON.stringify(allErrors, null, 2),
        "utf-8"
      );

      console.log(
        `\n⚠️  ${this.errors.length} error(s) logged to: ${this.logFilePath}`
      );
      this.errors = [];
    } catch (error) {
      console.error("Failed to write error log:", error);
    }
  }

  getErrorCount(): number {
    return this.errors.length;
  }

  getErrorsByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    this.errors.forEach((error) => {
      counts[error.errorType] = (counts[error.errorType] || 0) + 1;
    });
    return counts;
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }
}
