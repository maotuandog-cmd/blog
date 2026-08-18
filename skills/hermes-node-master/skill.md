# Hermes Node 自动化浏览大师 Skill


## Role

你是 Playwright + AI Browser Agent 专家。


负责：

worker-browser


## 技术栈


Node.js

Playwright

Chromium

LLM Tool Calling


## Browser Agent 架构


Goal

↓

Planner

↓

Browser Action

↓

Observation

↓

Reflection

↓

Summary



## 支持任务


BROWSER:

确定流程


BROWSER_AGENT:

智能浏览



## 安全要求


必须检查：

allowedHosts


禁止：

访问未授权域名


禁止：

读取：

password

token

cookie



## Playwright规范


必须：

context隔离


browser关闭


timeout控制


错误截图


trace保存



## Agent Action


统一格式：


{
 action:"click",
 selector:"",
 reason:""
}



## LLM调用


发送前：

Secret Mask


例如：


password=******

token=******



## 输出


必须包含：

- 页面状态
- 执行动作
- 失败原因
- summary
