# 数据库设计文档

## ER 图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    User     │────<│  ApiKey      │     │   Channel   │
│─────────────│     │─────────────│     │─────────────│
│ id          │     │ id          │     │ id          │
│ email       │     │ user_id     │     │ name        │
│ password    │     │ api_key     │     │ base_url    │
│ username    │     │ status      │     │ models      │
│ balance     │     │ usage_limit │     │ price_rate  │
│ is_admin    │     │ used_amount │     │ is_active   │
│ created_at  │     │ created_at  │     │ created_at  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                    │
       │                   │                    │
       │            ┌──────┴──────┐             │
       │            │   Log       │             │
       │            │─────────────│             │
       │            │ id          │             │
       │            │ api_key_id  │             │
       │            │ channel_id  │             │
       │            │ model       │             │
       │            │ tokens      │             │
       │            │ cost        │             │
       │            │ latency     │             │
       │            │ status     │             │
       │            │ created_at  │             │
       │            └─────────────┘             │
       │                                         │
       │            ┌─────────────┐              │
       └───────────>│   Recharge  │<────────────┘
                    │─────────────│
                    │ id          │
                    │ user_id     │
                    │ amount      │
                    │ status      │
                    │ order_no    │
                    │ created_at  │
                    └─────────────┘
```

## 表结构

### 1. users - 用户表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 用户ID |
| email | VARCHAR(255) | UNIQUE, NOT NULL | 邮箱 |
| username | VARCHAR(100) | NOT NULL | 用户名 |
| password | VARCHAR(255) | NOT NULL | 密码(加密) |
| balance | DECIMAL(10,2) | DEFAULT 0 | 余额 |
| is_admin | BOOLEAN | DEFAULT false | 是否管理员 |
| is_active | BOOLEAN | DEFAULT true | 是否激活 |
| last_login_at | TIMESTAMP | | 最后登录时间 |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |
| updated_at | TIMESTAMP | | 更新时间 |

### 2. api_keys - API Key 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| user_id | UUID | FK(users.id) | 用户ID |
| api_key | VARCHAR(64) | UNIQUE, NOT NULL | API Key |
| name | VARCHAR(100) | NOT NULL | Key名称 |
| status | ENUM | 'active','inactive' | 状态 |
| daily_limit | INTEGER | DEFAULT 10000 | 每日限制(次) |
| monthly_limit | INTEGER | DEFAULT 100000 | 每月限制(次) |
| used_today | INTEGER | DEFAULT 0 | 今日使用 |
| used_month | INTEGER | DEFAULT 0 | 本月使用 |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |
| updated_at | TIMESTAMP | | 更新时间 |

### 3. channels - 渠道表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 渠道ID |
| name | VARCHAR(100) | NOT NULL | 渠道名称 |
| channel_type | ENUM | 'openai','anthropic'... | 渠道类型 |
| base_url | VARCHAR(500) | NOT NULL | API地址 |
| api_key | VARCHAR(255) | | 上游API Key |
| models | JSONB | | 支持的模型列表 |
| priority | INTEGER | DEFAULT 0 | 优先级 |
| is_active | BOOLEAN | DEFAULT true | 是否启用 |
| balance | DECIMAL(10,2) | DEFAULT 0 | 渠道余额 |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |
| updated_at | TIMESTAMP | | 更新时间 |

### 4. channel_models - 渠道模型配置表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| channel_id | UUID | FK(channels.id) | 渠道ID |
| model_name | VARCHAR(100) | NOT NULL | 模型名称 |
| input_price | DECIMAL(10,4) | | 输入价格(元/千token) |
| output_price | DECIMAL(10,4) | | 输出价格(元/千token) |
| is_active | BOOLEAN | DEFAULT true | 是否启用 |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |

### 5. request_logs - 请求日志表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 日志ID |
| api_key_id | UUID | FK(api_keys.id) | API Key ID |
| channel_id | UUID | FK(channels.id) | 渠道ID |
| user_id | UUID | FK(users.id) | 用户ID |
| model | VARCHAR(100) | NOT NULL | 使用的模型 |
| prompt_tokens | INTEGER | | 输入Token |
| completion_tokens | INTEGER | | 输出Token |
| total_tokens | INTEGER | | 总Token |
| cost | DECIMAL(10,4) | | 消费金额 |
| latency_ms | INTEGER | | 延迟(ms) |
| status_code | INTEGER | | 状态码 |
| request_ip | VARCHAR(50) | | 请求IP |
| request_data | JSONB | | 请求数据 |
| response_data | JSONB | | 响应数据 |
| error_message | TEXT | | 错误信息 |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |

### 6. recharges - 充值记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 记录ID |
| user_id | UUID | FK(users.id) | 用户ID |
| order_no | VARCHAR(64) | UNIQUE | 订单号 |
| amount | DECIMAL(10,2) | NOT NULL | 充值金额 |
| bonus | DECIMAL(10,2) | DEFAULT 0 | 赠送金额 |
| payment_method | ENUM | 'alipay','wechat','stripe' | 支付方式 |
| payment_status | ENUM | 'pending','paid','failed' | 支付状态 |
| paid_at | TIMESTAMP | | 支付时间 |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |
| updated_at | TIMESTAMP | | 更新时间 |

### 7. model_pricing - 模型定价表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| model_name | VARCHAR(100) | UNIQUE, NOT NULL | 模型名称 |
| display_name | VARCHAR(200) | | 显示名称 |
| input_price | DECIMAL(10,4) | NOT NULL | 输入价格 |
| output_price | DECIMAL(10,4) | NOT NULL | 输出价格 |
| unit | VARCHAR(20) | DEFAULT '1k_tokens' | 计费单位 |
| is_active | BOOLEAN | DEFAULT true | 是否启用 |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |
| updated_at | TIMESTAMP | | 更新时间 |

### 8. rate_limits - 限流配置表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| api_key_id | UUID | FK(api_keys.id) | API Key ID |
| type | ENUM | 'daily','monthly','minute' | 限流类型 |
| limit_value | INTEGER | NOT NULL | 限制值 |
| window_seconds | INTEGER | | 窗口时间(秒) |
| created_at | TIMESTAMP | DEFAULT NOW | 创建时间 |

## 索引设计

```sql
-- 用户表索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_admin ON users(is_admin);

-- API Key 索引
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_api_key ON api_keys(api_key);

-- 渠道表索引
CREATE INDEX idx_channels_is_active ON channels(is_active);

-- 请求日志索引
CREATE INDEX idx_logs_api_key_id ON request_logs(api_key_id);
CREATE INDEX idx_logs_user_id ON request_logs(user_id);
CREATE INDEX idx_logs_channel_id ON request_logs(channel_id);
CREATE INDEX idx_logs_created_at ON request_logs(created_at);
CREATE INDEX idx_logs_model ON request_logs(model);

-- 充值记录索引
CREATE INDEX idx_recharges_user_id ON recharges(user_id);
CREATE INDEX idx_recharges_order_no ON recharges(order_no);
CREATE INDEX idx_recharges_status ON recharges(payment_status);
```

## 关系说明

1. **User -> ApiKey**: 一对多关系，一个用户可以有多个API Key
2. **User -> Recharge**: 一对多关系，一个用户可以有多条充值记录
3. **Channel -> ChannelModel**: 一对多关系，一个渠道可以配置多个模型
4. **ApiKey -> RequestLog**: 一对多关系，一个API Key可以产生多条日志
5. **Channel -> RequestLog**: 一对多关系，一个渠道可以产生多条日志
