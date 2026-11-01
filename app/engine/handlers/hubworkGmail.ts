import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";

export async function handleGmailSendNode(..._args: [WorkflowNode, ExecutionContext, ServiceContext]): Promise<never> {
  throw new Error("Gmail integration has been removed from kiokuflow. Remove the gmail-send node from this workflow.");
}
