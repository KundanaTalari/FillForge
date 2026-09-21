from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class PlaceholderItem(BaseModel):
    name: str
    type: str = "text"
    required: bool = True
    calculated: bool = False
    description: Optional[str] = None

class DocumentResponse(BaseModel):
    id: str
    name: str
    filename: str
    placeholders: List[PlaceholderItem]
    created_at: str

class GenerateRequest(BaseModel):
    format: str = Field(default="pdf", description="docx or pdf")
    values: Dict[str, Any] = Field(default_factory=dict)
    pf_mode: str = Field(default="fixed", description="fixed or percentage")
    pf_percentage: float = Field(default=12.0, description="Used when pf_mode is percentage")

class FailureItem(BaseModel):
    row: int
    error: str

class BulkGenerateResponse(BaseModel):
    succeeded: int
    failed: int
    failures: List[FailureItem]
    download_url: Optional[str] = None
    batch_id: Optional[str] = None

class SignUpRequest(BaseModel):
    name: str
    email: str
    password: str

class SignInRequest(BaseModel):
    email: str
    password: str
