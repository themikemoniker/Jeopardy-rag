output "alb_dns_name" {
  description = "ALB DNS name — access the app here"
  value       = "http://${aws_lb.main.dns_name}"
}

output "instance_public_ip" {
  description = "EC2 public IP (for SSH)"
  value       = aws_instance.app.public_ip
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.app.id
}

output "ssh_command" {
  description = "SSH command to connect"
  value       = "ssh ec2-user@${aws_instance.app.public_ip}"
}

output "data_volume_id" {
  description = "EBS volume ID for the SQLite database"
  value       = aws_ebs_volume.data.id
}
