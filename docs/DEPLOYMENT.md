# Deployment Guide

This guide covers deploying Mesynx AI to production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Docker Deployment (Recommended)](#docker-deployment-recommended)
- [Manual Deployment](#manual-deployment)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [SSL/TLS Configuration](#ssltls-configuration)
- [Backup & Restore](#backup--restore)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required

- Docker & Docker Compose (for Docker deployment)
- PostgreSQL 16+ (if not using Docker)
- Node.js 20+ (for manual deployment)
- Domain name with DNS configured
- SSL certificate (Let's Encrypt recommended)

### Recommended

- Reverse proxy (nginx, Caddy, Traefik)
- S3-compatible storage (for backups and file storage)
- SMTP server (for email notifications)

## Docker Deployment (Recommended)

### 1. Clone the Repository

```bash
git clone https://github.com/mesynx-ai/mesynx-ai.git
cd mesynx-ai
```

### 2. Configure Environment

Create the `.env` file from the template:

```bash
cp .env.example .env
```

Automatically generate and configure the required `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` secrets:

```bash
sed -i.bak "s/BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=$(openssl rand -hex 32)/" .env && rm -f .env.bak
sed -i.bak "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env && rm -f .env.bak
```

Edit `.env` with your values:

```env
# Database (use the service name from docker-compose.yml)
DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD@db:5432/mesynx-ai

# Auth
BETTER_AUTH_SECRET=<generated-secret>
APP_URL=https://your-domain.com

# Encryption
ENCRYPTION_KEY=<generated-key>

# Storage (use 's3' for production)
DEFAULT_STORAGE_TYPE=s3
S3_ENDPOINT=https://your-s3-endpoint.com
S3_BUCKET=mesynx-ai
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=<your-key>
S3_SECRET_ACCESS_KEY=<your-secret>

# SMTP (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@your-domain.com
```

### 3. Start Services

Start the containerized services using the consolidated Compose file. This builds the application locally from the source files and runs all services (`app`, `db`, and `whisper`) on a unified named network (`mesynx-network`):

```bash
docker compose up -d --build
```

### 4. Verify Deployment

```bash
# Check logs
docker compose logs -f app

# Check health
curl http://localhost:8790/api/health
```

### 5. Run Database Migrations

Migrations run automatically on container start. To run manually:

```bash
docker compose exec app pnpm db:migrate
```

## Manual Deployment

### 1. Install Dependencies

```bash
pnpm install --frozen-lockfile
```

### 2. Set Up PostgreSQL

```bash
# Create database
createdb mesynx-ai

# Update DATABASE_URL in .env
DATABASE_URL=postgresql://user:password@localhost:5432/mesynx-ai
```

### 3. Run Migrations

```bash
pnpm db:migrate
```

### 4. Build Application

```bash
pnpm build
```

### 5. Start Production Server

```bash
pnpm start
```

### 6. Process Manager (PM2)

For production, use a process manager:

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start pnpm --name mesynx-ai -- start

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `BETTER_AUTH_SECRET` | Auth secret (32+ chars) | Generate with `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Encryption key (64 hex chars) | Generate with `openssl rand -hex 32` |
| `APP_URL` | Public URL of your app | `https://mesynx-ai.example.com` |

### Optional Variables

| Variable | Description | Default |
| --- | --- | --- |
| `DEFAULT_STORAGE_TYPE` | Storage backend (`local` or `s3`) | `local` |
| `LOCAL_STORAGE_PATH` | Local storage directory | `./storage` |
| `S3_ENDPOINT` | S3-compatible endpoint | AWS default |
| `S3_BUCKET` | S3 bucket name | - |
| `S3_REGION` | S3 region | - |
| `S3_ACCESS_KEY_ID` | S3 access key | - |
| `S3_SECRET_ACCESS_KEY` | S3 secret key | - |
| `SMTP_HOST` | SMTP server hostname | - |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Use TLS | `false` |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASSWORD` | SMTP password | - |
| `SMTP_FROM` | From email address | - |

## Database Setup

### PostgreSQL Configuration

For production, configure PostgreSQL for performance:

```sql
-- postgresql.conf recommended settings

# Memory
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 16MB
maintenance_work_mem = 128MB

# Connections
max_connections = 100

# Write-Ahead Log
wal_buffers = 16MB
checkpoint_completion_target = 0.9

# Query Planning
random_page_cost = 1.1  # For SSD
effective_io_concurrency = 200  # For SSD
```

### Backup Strategy

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump mesynx-ai | gzip > /backups/mesynx-ai_$DATE.sql.gz

# Keep last 30 days
find /backups -name "mesynx-ai_*.sql.gz" -mtime +30 -delete
```

### Connection Pooling

For high traffic, use connection pooling:

```bash
# Install PgBouncer
apt-get install pgbouncer

# Configure /etc/pgbouncer/pgbouncer.ini
[databases]
mesynx-ai = host=localhost port=5432 dbname=mesynx-ai

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
```

Update `DATABASE_URL` to use PgBouncer:

```env
DATABASE_URL=postgresql://user:pass@localhost:6432/mesynx-ai
```

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name mesynx-ai.example.com;

    ssl_certificate /etc/letsencrypt/live/mesynx-ai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mesynx-ai.example.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    client_max_body_size 100M;  # For large audio files

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name mesynx-ai.example.com;
    return 301 https://$server_name$request_uri;
}
```

### Caddy

```caddyfile
mesynx-ai.example.com {
    reverse_proxy localhost:3000

    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "no-referrer-when-downgrade"
    }

    request_body {
        max_size 100MB
    }
}
```

## SSL/TLS Configuration

### Let's Encrypt with Certbot

```bash
# Install Certbot
apt-get install certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d mesynx-ai.example.com

# Auto-renewal (already set up by certbot)
certbot renew --dry-run
```

## Backup & Restore

### Database Backup

```bash
# Backup
docker compose exec db pg_dump -U postgres mesynx-ai > backup.sql

# Restore
docker compose exec -T db psql -U postgres mesynx-ai < backup.sql
```

### File Storage Backup

```bash
# Local storage
tar -czf storage-backup.tar.gz storage/

# S3 storage - already backed up by S3
```

### Full Backup Script

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/$DATE"
mkdir -p $BACKUP_DIR

# Database
docker compose exec db pg_dump -U postgres mesynx-ai | gzip > $BACKUP_DIR/db.sql.gz

# Environment config
cp .env.local $BACKUP_DIR/env.backup

# Docker volumes (if using local storage)
docker run --rm -v mesynx-ai_audio:/data -v $BACKUP_DIR:/backup alpine tar czf /backup/audio.tar.gz /data

echo "Backup completed: $BACKUP_DIR"
```

## Monitoring

### Health Checks

```bash
# Application health
curl https://mesynx-ai.example.com/api/health

# Database health
docker compose exec db pg_isready

# Docker container health
docker compose ps
```

### Log Monitoring

```bash
# Application logs
docker compose logs -f app

# Database logs
docker compose logs -f db

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Uptime Monitoring

Use external monitoring services:

- UptimeRobot
- Pingdom
- Better Uptime
- Healthchecks.io

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs app

# Common issues:
# - Missing environment variables
# - Database not ready
# - Port already in use
```

### Invalid Origin / 403 Forbidden on Sign-Up/Sign-In

If you see an "Invalid origin" toast message and a `403 (FORBIDDEN)` error in your browser console when trying to register or sign in:

- **Cause**: Better Auth strictly validates request origins against your configured `APP_URL`. If you access the server using a local IP, domain name, or a personal tunnel (such as Tailscale) that differs from what is configured in `APP_URL`, the request is blocked.
- **Solution**: Edit the `.env` file on your server and update the `APP_URL` variable to match the exact URL/IP address you use to access the dashboard in your browser.
  - Tailscale example: `APP_URL=http://100.11.22.33:8790`
  - Local network IP example: `APP_URL=http://192.168.1.50:8790`
- **Apply changes**: Restart the containers by running `docker compose up -d`.

### Database Connection Issues

```bash
# Verify database is running
docker compose ps db

# Check database logs
docker compose logs db

# Test connection
docker compose exec db psql -U postgres -c "SELECT 1"
```

### Storage Issues

```bash
# Check disk space
df -h

# Check storage permissions
ls -la storage/

# For S3 issues, verify credentials and endpoint
```

### Migration Failures

```bash
# Reset database (CAUTION: deletes all data)
docker compose down -v
docker compose up -d

# Or manually fix migration
docker compose exec db psql -U postgres mesynx-ai
```

### Performance Issues

1. **Check resource usage**

   ```bash
   docker stats
   ```

2. **Optimize database**

   ```bash
   docker compose exec db vacuumdb -U postgres -z mesynx-ai
   ```

3. **Enable caching**
   - Add Redis for session storage
   - Use CDN for static assets

4. **Scale horizontally**
   - Use load balancer
   - Multiple app containers
   - Read replicas for database

## Production Checklist

- [ ] Environment variables properly configured
- [ ] Secrets generated securely
- [ ] Database backups automated
- [ ] SSL/TLS enabled
- [ ] Reverse proxy configured
- [ ] Health checks in place
- [ ] Monitoring set up
- [ ] Logs being collected
- [ ] Firewall configured
- [ ] S3 storage configured (recommended)
- [ ] SMTP configured for notifications
- [ ] Regular security updates planned
- [ ] Disaster recovery plan documented

## Security Hardening

1. **Firewall**

   ```bash
   # UFW example
   ufw allow 22/tcp   # SSH
   ufw allow 80/tcp   # HTTP
   ufw allow 443/tcp  # HTTPS
   ufw enable
   ```

2. **Fail2Ban**

   ```bash
   apt-get install fail2ban
   systemctl enable fail2ban
   ```

3. **Regular Updates**

   ```bash
   # System updates
   apt-get update && apt-get upgrade

   # Container updates
   docker compose pull
   docker compose up -d
   ```

4. **Secrets Management**
   - Use Docker secrets
   - Or use environment secrets manager (AWS Secrets Manager, HashiCorp Vault)

## Scaling

For high-traffic deployments:

1. **Horizontal Scaling**

   ```yaml
   # docker-compose.yml
   services:
     app:
       deploy:
         replicas: 3
   ```

2. **Load Balancing**
   - nginx upstream
   - HAProxy
   - Cloud load balancers

3. **Database Optimization**
   - Connection pooling (PgBouncer)
   - Read replicas
   - Caching layer (Redis)

4. **CDN**
   - CloudFlare
   - AWS CloudFront
   - Fastly

## Support

For deployment help:

- GitHub Discussions: <https://github.com/mesynx-ai/mesynx-ai/discussions>
- Documentation: <https://github.com/mesynx-ai/mesynx-ai/tree/main/docs>
- Issues: <https://github.com/mesynx-ai/mesynx-ai/issues>
