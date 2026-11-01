import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";

export async function handleCalendarListNode(..._args: [WorkflowNode, ExecutionContext, ServiceContext]): Promise<never> {
  throw new Error("Google Calendar integration has been removed from kiokuflow. Remove the calendar node from this workflow.");
}

export async function handleCalendarCreateNode(..._args: [WorkflowNode, ExecutionContext, ServiceContext]): Promise<never> {
  throw new Error("Google Calendar integration has been removed from kiokuflow. Remove the calendar node from this workflow.");
}

export async function handleCalendarUpdateNode(..._args: [WorkflowNode, ExecutionContext, ServiceContext]): Promise<never> {
  throw new Error("Google Calendar integration has been removed from kiokuflow. Remove the calendar node from this workflow.");
}

export async function handleCalendarDeleteNode(..._args: [WorkflowNode, ExecutionContext, ServiceContext]): Promise<never> {
  throw new Error("Google Calendar integration has been removed from kiokuflow. Remove the calendar node from this workflow.");
}
