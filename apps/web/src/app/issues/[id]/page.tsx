"use client";

import { useParams } from "next/navigation";
import { IssueRunView } from "../IssueRunView";

/** 이슈 실행 전용 화면. 본체는 목록 다이얼로그와 공용인 IssueRunView. */
export default function IssueRunPage() {
  const { id } = useParams<{ id: string }>();
  return <IssueRunView id={id} />;
}
