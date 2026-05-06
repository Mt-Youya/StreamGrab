# 1. 确认本地配置已设置好
git config user.email "dd257248@163.com"
git config user.name "Mt-Youya"

# 2. 修改上次提交的作者信息
git commit --amend --reset-author --no-edit

# 3. 强推覆盖远端
git push --force