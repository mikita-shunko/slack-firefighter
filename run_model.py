from anthropic import AnthropicFoundry

endpoint = "ENDPOINT"
deployment_name = "claude-haiku-4-5"
api_key = "KEY"

client = AnthropicFoundry(
    api_key=api_key,
    base_url=endpoint
)

message = client.messages.create(
    model=deployment_name,
    messages=[
        {"role": "user", "content": "What is Dynatrace?"}
    ],
    max_tokens=1024,
)

print(message.content)
