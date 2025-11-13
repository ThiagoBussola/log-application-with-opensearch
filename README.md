# Log Application

A high-performance log analysis application built with OpenSearch, designed to efficiently ingest, store, and analyze large volumes of log data using Node.js streams for optimal performance.

## Overview

This application demonstrates best practices for working with OpenSearch at scale, focusing on:

- **Stream-based ingestion**: Optimized log insertion using Node.js streams to handle large datasets efficiently
- **Fast search and retrieval**: Leveraging OpenSearch's powerful search capabilities for real-time log analysis
- **Real-time analytics**: Generate insights from log data with aggregations, time-series analysis, and visualizations
- **Scalable architecture**: Designed to handle millions of log entries with efficient indexing and querying strategies

The application generates synthetic log data, ingests it into OpenSearch using streaming pipelines, and provides tools for analysis including terminal-based visualizations and PNG chart generation.

## Objectives

- Optimize log insertion and search operations in OpenSearch through stream-based processing
- Demonstrate efficient bulk ingestion patterns using Node.js streams
- Provide comprehensive log analytics with visual representations
- Showcase OpenSearch aggregation capabilities for log analysis
- Enable real-time monitoring and analysis of log patterns, errors, and performance metrics

## Prerequisites

- Node.js (v18 or higher)
- Docker and Docker Compose
- npm or yarn

## Installation

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables. Create a `.env` file in the project root:

```env
OPENSEARCH_NODE=https://localhost:9200
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=admin
```

## Start OpenSearch with Docker

```bash
docker-compose up -d
```

This will start OpenSearch on port 9200.

## Available Commands

### Initialization

```bash
# Create index template in OpenSearch
npm run init:opensearch
```

### Log Generation

```bash
# Generate 10,000 logs
npm run generate:logs:small

# Generate 100,000 logs
npm run generate:logs:medium

# Generate 200,000 logs
npm run generate:logs:full

# Generate custom amount of logs
npm run generate:logs 50000

# Generate logs to NDJSON file
npm run generate:logs:file 100000 logs.ndjson
```

### Log Analysis

```bash
# View analytics in terminal (last day)
npm run logs:analytics

# View analytics for N days
npm run logs:analytics 7

# Generate PNG charts
npm run logs:charts

# Generate charts for N days
npm run logs:charts 7
```

### Stream Ingestion

```bash
# Standard ingestion
npm run stream:ingest

# Fast ingestion
npm run stream:ingest:fast

# Maximum ingestion
npm run stream:ingest:max
```

### Statistics and Cleanup

```bash
# View OpenSearch statistics
npm run opensearch:stats

# Cleanup (dry-run)
npm run opensearch:cleanup

# Force cleanup
npm run opensearch:cleanup:all

# Clean old indices (older than 7 days)
npm run opensearch:cleanup:old
```

## Project Structure

```
log-application/
├── src/
│   ├── config/          # OpenSearch configuration
│   ├── graphql/         # GraphQL schema and resolvers
│   ├── opensearch/      # Index templates and setup
│   ├── scripts/         # Generation and analysis scripts
│   └── types/           # TypeScript types
├── logs/                # Generated logs and charts
└── docker-compose.yml   # Docker configuration
```

## Usage Examples

1. **Generate and analyze logs:**

```bash
# Generate logs
npm run generate:logs:medium

# View analytics
npm run logs:analytics

# Generate charts
npm run logs:charts
```

2. **Stream ingestion:**

```bash
npm run stream:ingest:fast
```

3. **Clean old data:**

```bash
npm run opensearch:cleanup:old
```

## Stop OpenSearch

```bash
docker-compose down
```

## Notes

- Charts are saved in `logs/charts/`
- Logs are indexed by date in format `logs-YYYY-MM-DD`
- The analytics script shows distributions by level, service, category, etc.
