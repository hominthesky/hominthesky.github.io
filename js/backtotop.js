function goTop()
{
    $(window).scroll(function(e) {
        //若滚动条离顶部大于100元素
        if($(window).scrollTop()>100)
            $("#top").fadeIn(1000);//以1秒的间隔渐显
        else
            $("#top").fadeOut(1000);//以1秒的间隔渐隐
    });
};
$(function(){
    //点击回到顶部元素
    $("#top").click(function(e) {
            //以1秒间隔返回顶部
            $('body,html').animate({scrollTop:0},1000);
    });
    $("#top").mouseover(function(e) {
        $(this).css("background-color","rgba(0,0,0,0.7)");
    });
    $("#top").mouseout(function(e) {
        $(this).css("color","#fff");
    });
    goTop();//实现回到顶部元素的渐显与渐隐
});
