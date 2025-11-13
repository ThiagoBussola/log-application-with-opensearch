# Application Flow Documentation

Este documento explica o fluxo de execução da aplicação, quem chama quem, e o que cada componente faz.

## Entry Points

A aplicação possui quatro scripts principais que podem ser executados diretamente:

1. **`stream-ingestion.ts`** - Ingestão de logs em massa usando streams
2. **`opensearch-stats.ts`** - Estatísticas do cluster OpenSearch
3. **`opensearch-cleanup.ts`** - Limpeza de índices no OpenSearch
4. **`init-opensearch.ts`** - Inicialização do OpenSearch (template e índice)

## 1. Stream Ingestion Flow

### Entry Point

**Script**: `src/scripts/stream-ingestion.ts`  
**Função**: `runIngestion()`

### Execution Flow

```
runIngestion()
  ├─> parseArgs()                    # Parse CLI arguments
  ├─> testConnection()               # Verify OpenSearch connection
  ├─> setupIndexTemplate()           # Create/update index template
  ├─> ensureIndex()                  # Create or reuse index
  │     └─> createBulkOptimizedIndex()  # Create index with bulk optimizations
  ├─> new ErrorLogger()              # Initialize error logging
  └─> generateLogs()                 # Main ingestion pipeline
        │
        ├─> new LogGeneratorStream()    # Generates log entries
        ├─> new LogMetricsCollector()   # Collects metrics from logs
        ├─> new BulkInsertTransform()   # Batches and inserts to OpenSearch
        └─> new ProgressTracker()        # Tracks and displays progress
        │
        └─> pipelineAsync()              # Executes stream pipeline
              │
              └─> Stream Flow:
                    LogGeneratorStream
                      └─> LogMetricsCollector
                            └─> BulkInsertTransform
                                  └─> ProgressTracker
  │
  ├─> optimizeIndexForSearch()      # Restore normal index settings
  └─> closeClient()                 # Close OpenSearch connection
```

### Component Details

#### `parseArgs()`

- **Localização**: `stream-ingestion.ts`
- **Função**: Parse command-line arguments
- **Retorna**: `StreamIngestionOptions` com configurações

#### `setupIndexTemplate()`

- **Localização**: `src/opensearch/setup.ts`
- **Função**: Cria ou atualiza o template de índice `logs-template`
- **Usa**: `LOG_INDEX_TEMPLATE` de `index-template.ts`

#### `ensureIndex()`

- **Localização**: `stream-ingestion.ts`
- **Função**: Verifica se índice existe, deleta se `--force`, cria se não existe
- **Chama**: `createBulkOptimizedIndex()` para criar índice otimizado

#### `createBulkOptimizedIndex()`

- **Localização**: `src/opensearch/setup.ts`
- **Função**: Cria índice com configurações otimizadas para bulk loading
- **Configurações**:
  - `refresh_interval: "-1"` (desabilitado)
  - `number_of_replicas: 0`
  - `index.translog.durability: "async"`
- **Inclui**: Mappings e analyzers do template

#### `generateLogs()`

- **Localização**: `src/scripts/generate-logs.ts`
- **Função**: Orquestra o pipeline de geração e inserção de logs
- **Cria os streams**:
  1. `LogGeneratorStream` - Gera logs usando `generateLog()` do Faker
  2. `LogMetricsCollector` - Coleta métricas (levels, services, response times, etc.)
  3. `BulkInsertTransform` - Agrupa logs em batches e insere no OpenSearch
  4. `ProgressTracker` - Mostra progresso a cada 2 segundos

#### `LogGeneratorStream`

- **Localização**: `src/scripts/generate-logs.ts`
- **Tipo**: `Readable` stream
- **Função**: Gera logs em chunks de 100 para não bloquear event loop
- **Chama**: `generateLog()` de `log-generator.ts` para cada log

#### `LogMetricsCollector`

- **Localização**: `src/scripts/transforms/log-metrics-collector.ts`
- **Tipo**: `Transform` stream
- **Função**: Coleta métricas de cada log (level, service, response time, CPU, memory, etc.)
- **Passa adiante**: O mesmo log para o próximo stream

#### `BulkInsertTransform`

- **Localização**: `src/scripts/bulk-insert.ts`
- **Tipo**: `Transform` stream
- **Função**:
  - Acumula logs em buffer
  - Quando buffer atinge `batchSize`, serializa para NDJSON
  - Envia batch para OpenSearch via `bulk()` API
  - Controla concorrência (máximo de `concurrency` batches simultâneos)
- **Serialização**: NDJSON format (action line + source line por documento)
- **Métricas**: Rastreia batches, documentos inseridos, falhas, durações

#### `ProgressTracker`

- **Localização**: `src/scripts/progress-tracker.ts`
- **Tipo**: `Transform` stream
- **Função**: Mostra progresso a cada 2 segundos (total, porcentagem, taxa, ETA)
- **Passa adiante**: Dados sem modificação

#### `optimizeIndexForSearch()`

- **Localização**: `src/opensearch/setup.ts`
- **Função**: Restaura configurações normais do índice após bulk loading
- **Ações**:
  - `refresh_interval: "30s"` (habilita refresh)
  - `number_of_replicas: 1` (adiciona réplicas)
  - `index.translog.durability: "request"` (durabilidade síncrona)
  - `indices.refresh()` (força refresh para tornar documentos pesquisáveis)

## 2. OpenSearch Stats Flow

### Entry Point

**Script**: `src/scripts/opensearch-stats.ts`  
**Função**: `main()`

### Execution Flow

```
main()
  ├─> parseArgs()                    # Parse CLI arguments (--index optional)
  ├─> testConnection()               # Verify OpenSearch connection
  ├─> getClusterStats()              # Get cluster-level statistics
  │     ├─> cluster.stats()          # Cluster statistics API
  │     ├─> indices.stats()          # All indices statistics
  │     └─> nodes.stats()            # Node statistics (heap, etc.)
  ├─> getIndexStats()                # Get per-index statistics
  │     ├─> cat.indices()            # List indices (or specific index)
  │     ├─> indices.stats()          # Per-index stats
  │     └─> indices.get()            # Index settings (shards, replicas)
  └─> printStats()                   # Format and display statistics
```

### Component Details

#### `getClusterStats()`

- **Função**: Coleta estatísticas do cluster
- **Retorna**: `ClusterStats` com documentos totais, heap usage, disk usage

#### `getIndexStats()`

- **Função**: Coleta estatísticas de índices (todos ou específico)
- **Retorna**: Array de `IndexStats` com documentos, tamanho, shards, replicas

#### `printStats()`

- **Função**: Formata e exibe estatísticas de forma legível
- **Mostra**: Cluster overview, top 10 índices, resumo de índices logs-\*

## 3. OpenSearch Cleanup Flow

### Entry Point

**Script**: `src/scripts/opensearch-cleanup.ts`  
**Função**: `main()`

### Execution Flow

```
main()
  ├─> parseArgs()                    # Parse CLI arguments
  │     # Supports: --pattern, --indices, --older-than, --dry-run, --force
  ├─> testConnection()               # Verify OpenSearch connection
  ├─> getAllIndices()                # Get indices (by pattern or specific names)
  ├─> getIndexStats()                # Get statistics for each index
  ├─> filterIndicesByAge()          # Filter by age if --older-than specified
  ├─> confirmDeletion()             # Interactive confirmation (unless --force)
  └─> deleteIndices()               # Delete indices (or dry-run)
```

### Component Details

#### `parseArgs()`

- **Função**: Parse arguments, suporta índices específicos ou padrão
- **Modos**:
  - Por padrão: `--pattern=logs-*`
  - Índices específicos: `index1 index2` ou `--indices=index1,index2`
  - Por idade: `--older-than=7` (dias)

#### `getAllIndices()`

- **Função**: Lista índices usando `cat.indices` API

#### `getIndexStats()`

- **Função**: Coleta estatísticas (documentos, tamanho, data de criação) para cada índice

#### `filterIndicesByAge()`

- **Função**: Filtra índices mais antigos que X dias usando `creation_date`

#### `confirmDeletion()`

- **Função**: Solicita confirmação interativa (digite "DELETE")
- **Pula se**: `--force` flag presente

#### `deleteIndices()`

- **Função**: Deleta índices ou mostra o que seria deletado (dry-run)
- **Usa**: `indices.delete()` API

## 4. Init OpenSearch Flow

### Entry Point

**Script**: `src/scripts/init-opensearch.ts`  
**Função**: `init()`

### Execution Flow

```
init()
  ├─> testConnection()               # Verify OpenSearch connection
  └─> setupOpenSearch()              # Setup template and create today's index
        ├─> setupIndexTemplate()     # Create index template
        └─> createTodayIndex()        # Create index for today (logs-YYYY-MM-DD)
```

### Component Details

#### `setupOpenSearch()`

- **Localização**: `src/opensearch/setup.ts`
- **Função**: Setup completo do OpenSearch
- **Ações**: Cria template e índice do dia

#### `createTodayIndex()`

- **Localização**: `src/opensearch/setup.ts`
- **Função**: Cria índice com nome `logs-YYYY-MM-DD` (data atual)
- **Usa**: Template `logs-template` automaticamente

## Data Flow Through Streams

### Stream Pipeline Execution

```
1. LogGeneratorStream._read()
   └─> generateLog() [log-generator.ts]
       └─> Cria LogEntry com dados sintéticos (Faker)
   └─> push(log) → LogMetricsCollector

2. LogMetricsCollector._transform()
   └─> Analisa log (level, service, metrics, etc.)
   └─> Atualiza contadores internos
   └─> push(log) → BulkInsertTransform

3. BulkInsertTransform._transform()
   └─> Adiciona log ao buffer
   └─> Se buffer.length >= batchSize:
       ├─> serializeNdjsonBatch() → NDJSON string
       ├─> scheduleFlush() → Adiciona promise ao pendingFlushes
       ├─> sendBatch() → opensearchClient.bulk()
       │     └─> Envia para OpenSearch
       └─> push({inserted, total}) → ProgressTracker

4. ProgressTracker._transform()
   └─> A cada 2 segundos: mostra progresso no console
   └─> push(chunk) → fim do pipeline
```

### NDJSON Serialization

Cada batch é serializado no formato NDJSON (Newline Delimited JSON):

```
{"index":{"_index":"logs-stream-2025-11-12"}}
{"id":"uuid","timestamp":"...","service":{...},...}
{"index":{"_index":"logs-stream-2025-11-12"}}
{"id":"uuid","timestamp":"...","service":{...},...}
```

Cada documento requer 2 linhas:

1. **Action line**: Metadados da operação (`index`, `_index`)
2. **Source line**: Conteúdo do documento

## Error Handling

### Error Logger

- **Localização**: `src/scripts/utils/error-logger.ts`
- **Função**: Captura e registra erros em arquivo JSON
- **Tipos de erro**:
  - `insertion` - Falhas na inserção de documentos
  - `stream` - Erros nos streams
  - `connection` - Erros de conexão com OpenSearch
  - `serialization` - Erros na serialização NDJSON

### Error Flow

1. Erros são capturados nos streams via event listeners
2. `ErrorLogger` registra em buffer em memória
3. `flush()` escreve todos os erros para arquivo JSON
4. Arquivo salvo em `./logs/errors-{indexName}-{timestamp}.json`

## Key Functions Reference

### Log Generation

- **`generateLog()`** (`log-generator.ts`): Gera um log sintético usando Faker
- **`weightedRandom()`** (`log-generator.ts`): Seleção aleatória com pesos

### OpenSearch Operations

- **`setupIndexTemplate()`** (`setup.ts`): Cria template de índice
- **`createBulkOptimizedIndex()`** (`setup.ts`): Cria índice otimizado para bulk
- **`optimizeIndexForSearch()`** (`setup.ts`): Restaura configurações normais
- **`testConnection()`** (`opensearch.config.ts`): Testa conexão com cluster

### Stream Operations

- **`pipelineAsync()`**: Executa pipeline de streams com tratamento de erros
- **`BulkInsertTransform.sendBatch()`**: Envia batch para OpenSearch
- **`BulkInsertTransform.serializeNdjsonBatch()`**: Serializa batch para NDJSON

## Execution Scenarios

### Scenario 1: Standard Ingestion

```bash
npm run stream:ingest
```

1. Parse arguments (600k logs, batch 4k, concurrency 2)
2. Setup template and create bulk-optimized index
3. Run stream pipeline (generate → metrics → bulk → progress)
4. Optimize index for search
5. Display summary

### Scenario 2: Fast Ingestion

```bash
npm run stream:ingest:fast
```

- Mesmo fluxo, mas com batch 15k e concurrency 4

### Scenario 3: Statistics

```bash
npm run opensearch:stats
```

1. Connect to OpenSearch
2. Get cluster stats
3. Get index stats (all or specific)
4. Display formatted output

### Scenario 4: Cleanup

```bash
npm run opensearch:cleanup:all
```

1. Connect to OpenSearch
2. Find indices matching pattern
3. Get statistics
4. Confirm deletion (or skip with --force)
5. Delete indices

## Dependencies

### Core Dependencies

- **OpenSearch Client**: `@opensearch-project/opensearch` - Cliente oficial
- **Streams**: Node.js built-in `stream` module
- **Faker**: `@faker-js/faker` - Geração de dados sintéticos

### Internal Dependencies

- **Types**: `src/types/log.types.ts` - Definição de `LogEntry`
- **Config**: `src/config/opensearch.config.ts` - Configuração do cliente
- **Template**: `src/opensearch/index-template.ts` - Template de índice

## File Organization

```
src/
├── config/
│   └── opensearch.config.ts       # OpenSearch client configuration
├── opensearch/
│   ├── index-template.ts          # Index template definition
│   └── setup.ts                   # Setup functions (template, index creation)
├── scripts/
│   ├── generate-logs.ts           # Main log generation function
│   ├── stream-ingestion.ts        # Entry point for ingestion
│   ├── bulk-insert.ts             # Bulk insert transform stream
│   ├── progress-tracker.ts        # Progress tracking stream
│   ├── opensearch-stats.ts        # Statistics script
│   ├── opensearch-cleanup.ts      # Cleanup script
│   ├── generators/
│   │   └── log-generator.ts       # Log generation using Faker
│   ├── transforms/
│   │   └── log-metrics-collector.ts  # Metrics collection stream
│   └── utils/
│       └── error-logger.ts        # Error logging utility
└── types/
    └── log.types.ts               # TypeScript type definitions
```

## Summary

A aplicação usa um pipeline de streams Node.js para gerar e inserir logs em massa no OpenSearch:

1. **Geração**: `LogGeneratorStream` cria logs sintéticos
2. **Métricas**: `LogMetricsCollector` analisa cada log
3. **Inserção**: `BulkInsertTransform` agrupa e insere em batches
4. **Progresso**: `ProgressTracker` mostra progresso

O fluxo é otimizado para performance com:

- Índices otimizados para bulk loading (refresh desabilitado, sem réplicas)
- Serialização NDJSON eficiente
- Controle de concorrência para não sobrecarregar OpenSearch
- Tratamento de erros robusto
