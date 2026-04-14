'use client';

import { useEffect } from 'react';
import { useLanguageStore } from '@/lib/store';

const PHRASES: Array<[string, string]> = [
  ['你的智能工作台', 'Your intelligent workspace'],
  ['登录 VGO AGENT', 'Sign in to VGO AGENT'],
  ['输入你的账户信息，继续进入智能工作台。', 'Enter your account details to continue to your workspace.'],
  ['邮箱', 'Email'],
  ['密码', 'Password'],
  ['请输入密码', 'Enter your password'],
  ['30 天内记住我', 'Remember me for 30 days'],
  ['忘记密码', 'Forgot password'],
  ['登录中...', 'Signing in...'],
  ['登录', 'Sign in'],
  ['还没有账户？', "Don't have an account?"],
  ['去注册', 'Create one'],
  ['注册 VGO AGENT', 'Create your VGO AGENT account'],
  ['先完成邮箱验证，再创建账户并进入你的智能工作台。', 'Verify your email first, then create your account and enter your intelligent workspace.'],
  ['邮箱地址', 'Email address'],
  ['邮箱验证码', 'Email verification code'],
  ['发送验证码', 'Send code'],
  ['用户名', 'Username'],
  ['确认密码', 'Confirm password'],
  ['注册中...', 'Creating account...'],
  ['完成注册', 'Create account'],
  ['已有账户？去登录', 'Already have an account? Sign in'],
  ['返回首页', 'Back to home'],
  ['聊天工作台', 'Chat Workspace'],
  ['数字团队', 'Digital Team'],
  ['新建对话', 'New conversation'],
  ['账号中心', 'Account Center'],
  ['模型目录', 'Model Catalog'],
  ['技能安装', 'Skill Install'],
  ['接入文档', 'Integration Docs'],
  ['管理后台', 'Admin Console'],
  ['退出登录', 'Sign out'],
  ['向 VGO AGENT 发送消息', 'Send a message to VGO AGENT'],
  ['向 VGO AI 发送消息', 'Send a message to VGO AGENT'],
  ['Enter 发送，Shift + Enter 换行', 'Press Enter to send, Shift + Enter for a new line'],
  ['发送', 'Send'],
  ['数字员工工作台', 'Digital Team Workspace'],
  ['先选任务模板，再自动带出一支团队。你可以直接下任务，也可以展开高级设置微调成员。', 'Choose a task template first, then generate a team automatically. You can assign the task directly or fine-tune members in advanced settings.'],
  ['任务模板', 'Task Templates'],
  ['创建团队', 'Create Team'],
  ['已有团队', 'Existing Teams'],
  ['高级设置', 'Advanced Settings'],
  ['保存团队', 'Save Team'],
  ['发起任务', 'Create Task'],
  ['让团队开始协作', 'Run Team Collaboration'],
  ['删除团队', 'Delete Team'],
  ['执行流程', 'Execution Flow'],
  ['团队群聊窗口', 'Team Group Chat'],
  ['执行摘要', 'Execution Summary'],
  ['最终交付', 'Final Deliverable'],
  ['新增成员', 'Add Member'],
  ['成员名称', 'Member Name'],
  ['职责与边界', 'Responsibility and Scope'],
  ['模型', 'Model'],
  ['负责人', 'Lead'],
  ['成员', 'Member'],
  ['主人', 'Owner'],
  ['任务发起', 'Task Request'],
  ['任务拆解', 'Task Breakdown'],
  ['总成本', 'Total Cost'],
  ['使用模型', 'Used Model'],
  ['已自动回退', 'Fallback Used'],
  ['Agent 执行', 'Agent Execution'],
  ['模型执行', 'Model Execution'],
  ['运营推广方案', 'Growth Launch Plan'],
  ['运营增长小组', 'Growth Team'],
  ['适合活动策划、站内推广、转化路径设计和上线排期。', 'Best for launch campaigns, onsite promotion, conversion flows, and rollout planning.'],
  ['客服响应方案', 'Customer Support Plan'],
  ['客户成功小组', 'Customer Success Team'],
  ['适合用户咨询、FAQ、充值引导、服务策略设计。', 'Best for FAQ design, user guidance, recharge instructions, and support strategy.'],
  ['管理员诊断任务', 'Admin Diagnosis Task'],
  ['平台诊断小组', 'Platform Diagnostics Team'],
  ['适合管理员排障、渠道诊断、模型健康度分析。', 'Best for incident analysis, channel diagnostics, and model health review.'],
  ['产品规划任务', 'Product Planning Task'],
  ['产品规划小组', 'Product Planning Team'],
  ['适合做产品方案、版本优先级、功能路线图。', 'Best for product strategy, prioritization, and roadmap work.'],
  ['项目负责人', 'Project Lead'],
  ['运营执行官', 'Operations Executor'],
  ['研究分析师', 'Research Analyst'],
  ['客服组长', 'Support Lead'],
  ['客户成功专员', 'Customer Success Specialist'],
  ['产品策略师', 'Product Strategist'],
  ['平台负责人', 'Platform Lead'],
  ['诊断专员', 'Diagnostics Specialist'],
  ['产品负责人', 'Product Lead'],
  ['执行专员', 'Execution Specialist'],
  ['Task Driven Workspace', '任务驱动工作区'],
  ['团队已保存，可以直接下任务。', 'Team saved. You can assign tasks now.'],
  ['请先保存团队，再让团队开始执行。', 'Please save the team before running it.'],
  ['这轮任务已经完成，下面可以直接看团队讨论与交付。', 'This run is complete. You can review the discussion and final deliverable below.'],
  ['现在可以直接给团队做任务了。点击开始后，负责人会先拆解，成员会在群聊式流程里逐个回应。', 'You can now assign work directly to the team. After you start, the lead will break down the task and members will respond in a group-chat style flow.'],
  ['1. 负责人拆解任务', '1. Lead breaks down the task'],
  ['负责人先生成执行计划和成员分工。', 'The lead creates the execution plan and assignments first.'],
  ['2. 成员联动讨论与执行', '2. Members discuss and execute'],
  ['每个成员按职位、模型、skill 输出自己的部分，必要时会调用站内工具。', 'Each member responds based on role, model, and skill, and may call tools when needed.'],
  ['3. 负责人汇总交付', '3. Lead finalizes the deliverable'],
  ['系统最后汇成一份完整方案，让你直接看到结果和执行轨迹。', 'The system compiles everything into one final deliverable with a visible execution trail.'],
  ['高级设置：团队成员', 'Advanced Settings: Team Members'],
  ['输入团队名称', 'Enter a team name'],
  ['用模板生成团队', 'Generate Team from Template'],
  ['未填写团队说明', 'No team description yet'],
  ['未填写团队说明。', 'No team description yet.'],
  ['把你的项目任务写在这里。', 'Write your project task here.'],
  ['这里会像一个群聊一样展示团队讨论过程。先保存团队，再发起一条任务试试。', 'This area will show the team discussion like a group chat. Save the team first, then run a task.'],
  ['位数字员工', 'digital workers'],
  ['执行摘要', 'Execution Summary'],
  ['负责人计划', 'Lead Plan'],
  ['草稿', 'Draft'],
  ['待审批', 'Pending Approval'],
  ['已批准', 'Approved'],
  ['执行中', 'Running'],
  ['已完成', 'Completed'],
  ['已拒绝', 'Rejected'],
  ['公司工作台', 'Company Workspace'],
  ['任务、团队执行、审批与交付统一汇聚。', 'One place for tasks, team execution, approvals, and deliverables.'],
  ['返回聊天', 'Back to chat'],
  ['管理团队', 'Manage teams'],
  ['任务', 'Tasks'],
  ['待审批', 'Pending approvals'],
  ['运行中', 'Running'],
  ['交付物', 'Deliverables'],
  ['活跃团队', 'Active teams'],
  ['创建、分配并执行。', 'Create, assign, and run.'],
  ['新建', 'New'],
  ['还没有任务，创建第一个吧。', 'No tasks yet. Create your first one.'],
  ['模板已应用。', 'Template applied.'],
  ['任务已保存。', 'Task saved.'],
  ['任务已保存并等待审批。', 'Task saved and waiting for approval.'],
  ['团队执行已完成，交付物已生成。', 'Team execution finished. Deliverable generated.'],
  ['审批已通过。', 'Approval granted.'],
  ['审批已拒绝。', 'Approval rejected.'],
  ['交付物已导出。', 'Deliverable exported.'],
  ['模板已更新。', 'Template updated.'],
  ['模板已创建。', 'Template created.'],
  ['模板已删除。', 'Template deleted.'],
  ['正在加载工作台...', 'Loading workspace...'],
  ['服务暂时不可用，请稍后再试。', 'The service is temporarily unavailable. Please try again shortly.'],
  ['The service is temporarily unavailable. Please try again shortly.', '服务暂时不可用，请稍后再试。'],
  ['Workspace OS', '工作台系统'],
  ['Company Workspace', '公司工作台'],
  ['One place for tasks, team execution, approvals, and final deliverables.', '任务、团队执行、审批与最终交付统一汇聚。'],
  ['Back to chat', '返回聊天'],
  ['Manage teams', '管理团队'],
  ['Tasks', '任务'],
  ['Pending approvals', '待审批'],
  ['Running', '运行中'],
  ['Completed', '已完成'],
  ['Deliverables', '交付物'],
  ['Active teams', '活跃团队'],
  ['Create, assign, and run.', '创建、分配并执行。'],
  ['New', '新建'],
  ['No tasks yet. Create your first one.', '还没有任务，创建第一个吧。'],
  ['Task saved and waiting for approval.', '任务已保存并等待审批。'],
  ['Task saved.', '任务已保存。'],
  ['Team execution finished. Deliverable generated.', '团队执行已完成，交付物已生成。'],
  ['Approval granted.', '审批已通过。'],
  ['Approval rejected.', '审批已拒绝。'],
  ['Deliverable exported.', '交付物已导出。'],
  ['Template updated.', '模板已更新。'],
  ['Template created.', '模板已创建。'],
  ['Template deleted.', '模板已删除。'],
  ['Failed to load the workspace.', '加载工作台失败。'],
  ['Failed to save task.', '保存任务失败。'],
  ['Failed to run task.', '运行任务失败。'],
  ['Failed to update approval.', '更新审批失败。'],
  ['Failed to export deliverable.', '导出交付物失败。'],
  ['Failed to save template.', '保存模板失败。'],
  ['Failed to delete template.', '删除模板失败。'],
  ['Loading workspace...', '正在加载工作台...'],
];

function translateTextNode(text: string, language: 'zh' | 'en') {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const pair = PHRASES.find(([zh, en]) => trimmed === zh || trimmed === en);
  if (!pair) return text;

  const replacement = language === 'zh' ? pair[0] : pair[1];
  return text.replace(trimmed, replacement);
}

function applyLanguage(language: 'zh' | 'en') {
  if (typeof document === 'undefined') return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement) continue;
    const tag = node.parentElement.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    textNodes.push(node);
  }

  textNodes.forEach((node) => {
    const next = translateTextNode(node.textContent || '', language);
    if (next !== node.textContent) {
      node.textContent = next;
    }
  });

  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]').forEach((element) => {
    const next = translateTextNode(element.placeholder, language);
    if (next !== element.placeholder) {
      element.placeholder = next;
    }
  });
}

export default function LanguageRuntime() {
  const { language, hydrated } = useLanguageStore();

  useEffect(() => {
    if (!hydrated) return;

    applyLanguage(language);

    const observer = new MutationObserver(() => {
      applyLanguage(language);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [hydrated, language]);

  return null;
}
