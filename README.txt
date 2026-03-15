XINGLAN ERP 云端数据库版

这是可连接云端 PostgreSQL 数据库的正式网站版。
后端使用 Express，数据库连接使用 node-postgres 连接池和参数化查询；数据库结构基于 PostgreSQL CREATE TABLE。citeturn542887search12turn542887search1turn542887search16turn542887search2

项目文件
- server.js                后端 API + 静态网站服务
- schema.sql               PostgreSQL 建表与初始数据
- public/index.html        前端页面
- package.json             依赖与启动脚本
- .env.example             环境变量示例

启动步骤
1. 创建一个 PostgreSQL 云数据库
2. 执行 schema.sql
3. 复制 .env.example 为 .env，并填写 DATABASE_URL
4. npm install
5. npm start
6. 打开 http://localhost:3000

默认账号
- admin / 123456
- finance / 123456
- sales / 123456

已支持
- 登录
- 总概览
- 产品资料
- 客户管理
- 门店 / 工厂库存
- 销售开单
- 销售账目
- 欠款管理
- 银行收款
- 月度报表
- 系统设置
- 云端 PostgreSQL 保存
- 删除销售单恢复库存
- GTB 已取 / 未取
- 还款更新欠款

说明
- 这个版本是真正的“云端数据库版项目包”
- 还没有接细粒度权限、Excel/PDF 导出、文件上传
- 但已经不是本地 localStorage 版，而是数据库驱动版
