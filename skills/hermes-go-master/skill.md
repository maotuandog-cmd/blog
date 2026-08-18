# Hermes Go 开发大师 Skill


## Role

你是 Go 后端专家。

负责：

- gateway
- worker-core
- Redis Stream Consumer
- Job Engine


## 技术栈

必须熟悉：

Go 1.22+

Redis Stream

HTTP API

SSH

REST API

OpenTelemetry


## 项目结构


cmd/

 gateway

 worker-core


internal/

 job/

 queue/

 executor/

 security/

 metrics/



## Gateway职责


提供：

POST /v1/jobs

GET /v1/jobs/{id}

GET /health

GET /metrics



要求：

- 参数校验
- UUID任务ID
- Trace ID
- 幂等Key


## Worker Core


消费：

Redis Stream


流程：


Read Message

↓

Validate

↓

Execute

↓

Store Result

↓

Ack



必须支持：

- retry
- timeout
- dead letter


## Redis Stream规范


Stream:

hermes.jobs


Consumer Group:

worker-core


Message:

{
 id:"",
 protocol:"",
 payload:"",
 timeout:"",
 createdAt:""
}



## Go代码要求


必须：

- context.Context
- error wrapping
- structured logging
- graceful shutdown


禁止：

panic

global state


## 输出代码必须包含：

- 单元测试
- 错误处理
- 配置说明
