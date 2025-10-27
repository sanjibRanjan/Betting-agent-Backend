# Sanjib Agent - Cricket Betting App

A production-ready Node.js/Express cricket betting application with real-time data integration, Redis caching, and Socket.IO broadcasting.

## Features

- **Real-time Cricket Data**: Integration with CricketData.org API
- **Redis Caching**: 60-second TTL with fallback mechanisms
- **Socket.IO Broadcasting**: Real-time updates to connected clients
- **Comprehensive Error Handling**: Graceful fallbacks and detailed logging
- **Modular Architecture**: Clean, maintainable codebase
- **Production Ready**: Robust error handling and monitoring

## Quick Start

### Prerequisites

- Node.js 16+ 
- Redis server
- CricketData.org API key

### Installation

1. **Clone and install dependencies:**
```bash
cd "Sanjib Agent"
npm install
```

2. **Configure environment variables:**
Create a `.env` file in the root directory:
```bash
# Server Configuration
PORT=5000
NODE_ENV=development

# SportMonks Cricket API Configuration
CRICKET_API_KEY=nPhIHrWHHOgoHkqWtmh4X8OYCjg6siT9bBb4UPLtB4ddIb7nueXB6kxmlxRX
CRICKET_API_BASE_URL=https://cricket.sportmonks.com/api/v2.0

# Redis Configuration
REDIS_URL=redis://127.0.0.1:6379

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=cricket-app.log

# Polling Configuration
POLL_INTERVAL_MS=10000
CACHE_TTL_SECONDS=60
```

3. **Start Redis server:**
```bash
redis-server
```

4. **Start the application:**
```bash
npm start
```

The server will start on `http://localhost:5000`

## API Endpoints

### Live Matches
- `GET /api/live-matches` - Get current live matches
- `GET /api/live-matches/refresh` - Force refresh matches
- `GET /api/live-matches/status` - Get service status
- `DELETE /api/live-matches/cache` - Clear cache

### Health Check
- `GET /api/health` - Service health status

## Socket.IO Events

### Client Events
- `matches:request` - Request current matches
- `matches:subscribe` - Subscribe to live updates
- `matches:unsubscribe` - Unsubscribe from updates

### Server Events
- `matches:data` - Current matches data
- `matches:update` - Live matches update
- `matches:live` - Live matches for subscribers
- `matches:error` - Error notifications

## Architecture

### Services

1. **CricketService** (`core/cricketService.js`)
   - Fetches live matches from CricketData.org API
   - Handles multiple endpoint fallbacks
   - Rate limiting and error handling
   - Data normalization

2. **CacheService** (`utils/cacheService.js`)
   - Redis-based caching with TTL
   - Cache validation and metadata
   - Performance monitoring

3. **SocketService** (`utils/socketService.js`)
   - Real-time broadcasting
   - Client connection management
   - Automatic updates

4. **LoggerService** (`utils/loggerService.js`)
   - Structured logging
   - Performance metrics
   - Error tracking

### Error Handling

The application implements comprehensive error handling:

1. **API Failures**: Falls back to cached data
2. **Cache Failures**: Continues with fresh API data
3. **Network Issues**: Retries with exponential backoff
4. **Service Errors**: Emergency fallbacks to mock data

### Caching Strategy

- **Primary**: Fresh API data cached for 60 seconds
- **Fallback**: Stale cache data when API fails
- **Emergency**: Mock data when all else fails

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 5000 | Server port |
| `CRICKET_API_KEY` | Required | CricketData.org API key |
| `REDIS_URL` | redis://127.0.0.1:6379 | Redis connection URL |
| `LOG_LEVEL` | info | Logging level |
| `POLL_INTERVAL_MS` | 10000 | Polling interval |
| `CACHE_TTL_SECONDS` | 60 | Cache TTL |

### API Configuration

The CricketService tries multiple endpoints:
- `/matches/live`
- `/currentMatches`
- `/live-matches`
- `/matches/current`
- `/matches` (with query parameters)

## Monitoring

### Logs

All operations are logged with structured JSON:
- API requests and responses
- Cache operations
- Socket.IO events
- Error details with stack traces

### Metrics

- Request duration tracking
- Cache hit/miss ratios
- API success/failure rates
- Socket.IO client counts

## Production Deployment

### Docker Support

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

### Environment Setup

1. Set `NODE_ENV=production`
2. Configure production Redis instance
3. Set up proper logging (Winston, etc.)
4. Configure monitoring (Prometheus, etc.)
5. Set up load balancing if needed

### Security Considerations

- Use environment variables for sensitive data
- Implement proper CORS policies
- Add rate limiting
- Use HTTPS in production
- Monitor API usage and costs

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Ensure Redis server is running
   - Check Redis URL configuration
   - Verify network connectivity

2. **API Authentication Failed**
   - Verify API key is correct
   - Check API key permissions
   - Monitor API usage limits

3. **No Live Matches**
   - Check if matches are currently live
   - Verify API endpoint availability
   - Review error logs for details

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

## Development

### Adding New Features

1. Follow the modular architecture
2. Add comprehensive error handling
3. Include structured logging
4. Write tests for new functionality
5. Update documentation

### Testing

```bash
# Run tests (when implemented)
npm test

# Test API endpoints
curl http://localhost:5000/api/health
curl http://localhost:5000/api/live-matches
```

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the logs for error details
2. Verify configuration settings
3. Test API connectivity
4. Review this documentation