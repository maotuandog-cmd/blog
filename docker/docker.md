> 系统化文档：[[Docker 常用命令]] · [[docker-compose 使用说明]] · [[Dockerfile 编写指南]] · [[Docker 存储与网络]] · [[Docker 网络实现原理]]

检查端口
```
docker ps --format 'table {{.Names}}\t{{.Ports}}'
docker inspect f4a7d25be198 --format '{{json .NetworkSettings.Networks}}'
```
```
docker compose -f docker-compose.yaml config --images \
  | sort -u > images.txt
  
  while IFS= read -r image; do
    [ -z "$image" ] && continue
    echo "========== Pulling: $image =========="

    if ! docker pull "$image"; then
        echo "拉取失败: $image"
        break
    fi
done < images.txt

echo "脚本执行结束"




failed=0

while IFS= read -r image; do
    [ -z "$image" ] && continue
    echo "========== Pulling: $image =========="

    if ! docker pull "$image"; then
        echo "拉取失败: $image"
        failed=1
    fi
done < images.txt

if [ "$failed" -eq 0 ]; then
    echo "所有镜像均拉取成功"
else
    echo "部分镜像拉取失败，请检查上面的日志"
fi





docker save -o dify-images.tar $(cat images.txt) &&
gzip -1 dify-images.tar




```

